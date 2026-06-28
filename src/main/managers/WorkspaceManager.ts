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
import { validateWorkspacePath } from './workspace/validate';

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
  private get db(): Database.Database {
    return getDb();
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

  /* ------------------------------------------------------------- writes */

  /** Register a directory as a new workspace (or open it if it already exists). */
  create(inputPath: string): Workspace {
    return this.register(inputPath, 'created');
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
    const next: WorkspaceConfig = {
      ...ws.config,
      ...patch,
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
  }

  private clearActive(): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(ACTIVE_KEY);
    this.broadcast();
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
