/**
 * Workspace Manager — owns the lifecycle of every workspace (the app's complete
 * representation of a project) and is the central source of truth the renderer
 * reads through IPC. Lives in the main process; persists to SQLite.
 *
 * Responsibilities: create / open / list / switch / remove workspaces, run the
 * validation + detection pipeline, derive icons and statistics, track the
 * lifecycle state machine, and broadcast changes to all windows.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { DEFAULT_WORKSPACE_CONFIG } from '@shared/constants';
import type {
  DeepPartial,
  Workspace,
  WorkspaceConfig,
  WorkspaceLifecycle,
  WorkspaceStats,
  WorkspaceValidationResult,
} from '@shared/types';
import { getDb } from '../db/database';
import { logger } from '../logger';
import path from 'node:path';
import { deriveIcon } from './workspace/icon';
import { detectWorkspace } from './workspace/detect';
import { computeStats } from './workspace/stats';
import { validateWorkspacePath, isInsideRoot } from './workspace/validate';

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  icon: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  favorite: number;
  lifecycle: string;
  health: string;
  metadata: string;
  config: string;
}

const ACTIVE_KEY = 'activeWorkspaceId';

/** Thrown by create/open when validation fails; carries structured diagnostics. */
export class WorkspaceValidationError extends Error {
  constructor(public readonly validation: WorkspaceValidationResult) {
    super(validation.errors.join(' '));
    this.name = 'WorkspaceValidationError';
  }
}

export class WorkspaceManager {
  /** In-process listeners notified when the *active* workspace changes. */
  private readonly activeListeners = new Set<(ws: Workspace | null) => void>();

  private get db(): Database.Database {
    return getDb();
  }

  /**
   * Subscribe to active-workspace changes inside the main process (e.g. the File
   * System Layer starts watching/indexing the new root). Returns an unsubscribe.
   */
  onActiveChanged(cb: (ws: Workspace | null) => void): () => void {
    this.activeListeners.add(cb);
    return () => this.activeListeners.delete(cb);
  }

  private emitActiveChanged(): void {
    const active = this.getActive();
    for (const cb of this.activeListeners) {
      try {
        cb(active);
      } catch {
        /* a listener fault must never break workspace state */
      }
    }
  }

  /* -------------------------------------------------------------- reads */

  list(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY favorite DESC, last_opened_at DESC')
      .all() as WorkspaceRow[];
    return rows.map(rowToWorkspace);
  }

  getActive(): Workspace | null {
    const id = this.activeId();
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | WorkspaceRow
      | undefined;
    return row ? rowToWorkspace(row) : null;
  }

  getStats(id: string): WorkspaceStats | null {
    const ws = this.byId(id);
    if (!ws) return null;
    return computeStats(ws.path, ws.config);
  }

  /** Public lookup by id (null when unknown). Used by the File System Layer. */
  getById(id: string): Workspace | null {
    return this.byId(id);
  }

  /* ------------------------------------------------------------- writes */

  /** Register a directory as a new workspace (or open it if it already exists). */
  create(inputPath: string): Workspace {
    return this.register(inputPath, 'created');
  }

  /**
   * Create a brand-new project directory inside `parentPath` and register it as a
   * workspace. Unlike `create()` (which expects an already-existing folder), this
   * makes the folder itself so the in-app "Create workspace" flow never has to pop
   * the native OS folder dialog.
   *
   * Security (CLAUDE.md §6): the parent is validated through the same pipeline as
   * an opened workspace (realpath, forbidden roots, home dir, read/write perms);
   * the leaf name is re-checked to stay directly inside that *real* parent so a
   * crafted name with separators or `..` can never escape the chosen location; the
   * directory is created non-recursively and an existing non-empty folder is
   * refused; `git init` runs argv-only (no `shell: true`) with a bounded timeout
   * and its failure is soft (the workspace is still valid without a repo).
   */
  createNew(input: { name: string; parentPath: string; initGit: boolean }): Workspace {
    const name = input.name.trim();

    // Validate + canonicalize the parent directory (reuses the open-time checks).
    const { result, realPath: parentReal } = validateWorkspacePath(input.parentPath, {
      existingPaths: [],
    });
    if (!result.ok) {
      throw new WorkspaceValidationError(result);
    }

    const target = path.join(parentReal, name);
    // Defense in depth: after path.join, the new folder must be a *direct* child of
    // the real parent. This rejects any name that still slipped a separator or `..`.
    if (!isInsideRoot(parentReal, target) || path.dirname(target) !== parentReal) {
      throw new WorkspaceValidationError({
        ok: false,
        errors: ['The workspace name must be a single folder name, not a path.'],
        warnings: [],
      });
    }

    // Create the directory. Never silently adopt a pre-existing, non-empty folder.
    if (fs.existsSync(target)) {
      if (fs.readdirSync(target).length > 0) {
        throw new WorkspaceValidationError({
          ok: false,
          errors: ['A non-empty folder with that name already exists at this location.'],
          warnings: [],
        });
      }
    } else {
      fs.mkdirSync(target, { recursive: false });
    }

    if (input.initGit) {
      try {
        execFileSync('git', ['init'], { cwd: target, timeout: 5000, stdio: 'ignore' });
      } catch (err) {
        logger.warn('workspace:createNew git init failed (workspace still created)', err);
      }
    }

    // Register the freshly-created path through the shared pipeline (detect + icon +
    // persist + set active). Logs the workspace id, not the raw path.
    return this.register(target, 'created');
  }

  /** Open an existing directory as a workspace (same pipeline as create). */
  open(inputPath: string): Workspace {
    const existing = this.findByRealPath(inputPath);
    if (existing) {
      this.touch(existing.id);
      this.setActive(existing.id);
      return this.requireById(existing.id);
    }
    return this.register(inputPath, 'opening');
  }

  switch(id: string): Workspace {
    this.requireById(id);
    this.setLifecycle(id, 'loading');
    this.touch(id);
    this.setActive(id);
    this.setLifecycle(id, 'ready');
    return this.requireById(id);
  }

  remove(id: string, deleteFiles = false): void {
    const ws = this.byId(id);
    if (!ws) return;
    if (deleteFiles) {
      // Intentionally conservative: file deletion is NOT performed here. The
      // renderer must obtain explicit confirmation via the native dialog and a
      // future, separate, audited path will handle on-disk removal.
      logger.warn('remove(deleteFiles=true) requested; files preserved by policy', ws.path);
    }
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    if (this.activeId() === id) this.clearActive();
    this.broadcast();
  }

  toggleFavorite(id: string): Workspace {
    const ws = this.requireById(id);
    this.db
      .prepare('UPDATE workspaces SET favorite = ?, updated_at = ? WHERE id = ?')
      .run(ws.favorite ? 0 : 1, Date.now(), id);
    this.broadcast();
    return this.requireById(id);
  }

  /** Merge a partial config patch (caller has already rejected polluting keys). */
  updateConfig(id: string, patch: DeepPartial<WorkspaceConfig>): Workspace {
    const ws = this.requireById(id);
    // planDefaultMode is renderer-supplied and feeds the composer's permission
    // selector — clamp to the enum. A present-but-invalid/undefined value clears
    // the override (inherit the global default); an absent key keeps the current.
    const mode = patch.planDefaultMode;
    const planDefaultMode =
      mode === 'plan' || mode === 'ask' || mode === 'default' || mode === 'acceptEdits'
        ? mode
        : 'planDefaultMode' in patch
          ? undefined
          : ws.config.planDefaultMode;
    const next: WorkspaceConfig = {
      ...ws.config,
      ...patch,
      planDefaultMode,
      ignoredDirs: patch.ignoredDirs ?? ws.config.ignoredDirs,
    };
    this.db
      .prepare('UPDATE workspaces SET config = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), Date.now(), id);
    this.broadcast();
    return this.requireById(id);
  }

  /**
   * Re-run the environmental detection pipeline for an already-registered
   * workspace and persist the refreshed metadata. Used by the "Rescan" action so
   * a changed git branch, new lockfile, or added framework is reflected without
   * re-opening the folder. The icon and identity stay stable; only metadata +
   * health + updated_at change. Re-validates the path first so a folder that has
   * since moved or lost permissions surfaces a clear error instead of stale data.
   */
  rescan(id: string): Workspace {
    const ws = this.requireById(id);
    const { result } = validateWorkspacePath(ws.path, { existingPaths: [] });
    if (!result.ok) {
      throw new WorkspaceValidationError(result);
    }
    const metadata = detectWorkspace(ws.path);
    const health: Workspace['health'] = result.warnings.length ? 'warning' : 'ok';
    this.db
      .prepare('UPDATE workspaces SET metadata = ?, health = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), health, Date.now(), id);
    logger.info(`Workspace rescanned: ${ws.name} (${ws.path})`);
    this.broadcast();
    return this.requireById(id);
  }

  /* -------------------------------------------------------- internals */

  private register(inputPath: string, initial: WorkspaceLifecycle): Workspace {
    const existingPaths = this.db
      .prepare('SELECT path FROM workspaces')
      .all()
      .map((r) => (r as { path: string }).path);

    const { result, realPath } = validateWorkspacePath(inputPath, { existingPaths });
    if (!result.ok) {
      throw new WorkspaceValidationError(result);
    }

    const name = path.basename(realPath) || realPath;
    const metadata = detectWorkspace(realPath);
    const icon = deriveIcon(name);
    const now = Date.now();

    const ws: Workspace = {
      id: crypto.randomUUID(),
      name,
      path: realPath,
      icon,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      favorite: false,
      lifecycle: 'ready',
      health: result.warnings.length ? 'warning' : 'ok',
      metadata,
      config: { ...DEFAULT_WORKSPACE_CONFIG },
    };

    this.db
      .prepare(
        `INSERT INTO workspaces
          (id, name, path, icon, created_at, updated_at, last_opened_at, favorite, lifecycle, health, metadata, config)
         VALUES (@id, @name, @path, @icon, @created_at, @updated_at, @last_opened_at, @favorite, @lifecycle, @health, @metadata, @config)`,
      )
      .run({
        id: ws.id,
        name: ws.name,
        path: ws.path,
        icon: JSON.stringify(ws.icon),
        created_at: ws.createdAt,
        updated_at: ws.updatedAt,
        last_opened_at: ws.lastOpenedAt,
        favorite: 0,
        lifecycle: ws.lifecycle,
        health: ws.health,
        metadata: JSON.stringify(ws.metadata),
        config: JSON.stringify(ws.config),
      });

    void initial; // lifecycle settles at 'ready' once registration completes
    this.setActive(ws.id);
    logger.info(`Workspace registered: ${ws.name} (${ws.path})`);
    return ws;
  }

  private byId(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | WorkspaceRow
      | undefined;
    return row ? rowToWorkspace(row) : null;
  }

  private requireById(id: string): Workspace {
    const ws = this.byId(id);
    if (!ws) throw new Error(`Workspace ${id} not found`);
    return ws;
  }

  private findByRealPath(inputPath: string): Workspace | null {
    const { realPath } = validateWorkspacePath(inputPath, { existingPaths: [] });
    if (!realPath) return null;
    const row = this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(realPath) as
      | WorkspaceRow
      | undefined;
    return row ? rowToWorkspace(row) : null;
  }

  private touch(id: string): void {
    this.db
      .prepare('UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(Date.now(), Date.now(), id);
  }

  private setLifecycle(id: string, lifecycle: WorkspaceLifecycle): void {
    this.db.prepare('UPDATE workspaces SET lifecycle = ? WHERE id = ?').run(lifecycle, id);
  }

  private activeId(): string | null {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(ACTIVE_KEY) as
      | { value: string | null }
      | undefined;
    return row?.value ?? null;
  }

  private setActive(id: string): void {
    this.db
      .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(ACTIVE_KEY, id);
    this.broadcast();
    this.emitActiveChanged();
  }

  private clearActive(): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(ACTIVE_KEY);
    this.broadcast();
    this.emitActiveChanged();
  }

  private broadcast(): void {
    const list = this.list();
    const active = this.getActive();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcEvents.workspacesUpdated, list);
        win.webContents.send(IpcEvents.workspaceChanged, active);
      }
    }
  }
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    icon: JSON.parse(row.icon),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    favorite: row.favorite === 1,
    lifecycle: row.lifecycle as WorkspaceLifecycle,
    health: row.health as Workspace['health'],
    metadata: JSON.parse(row.metadata),
    config: JSON.parse(row.config),
  };
}
