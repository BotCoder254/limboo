/**
 * Session Manager — owns the lifecycle of every development session (the
 * primary unit of work in Limboo) and is the source of truth the renderer reads
 * through IPC. Lives in the main process; persists to SQLite.
 *
 * Modeled on {@link WorkspaceManager}: a `db` accessor, prepared/bound
 * statements only (CLAUDE.md §6 — never interpolate values into SQL), row→model
 * mappers, an `app_state` row for the active id, and a `broadcast()` that pushes
 * the list + active id to every window on change.
 *
 * Sessions are scoped to a workspace; the renderer passes the active
 * `workspaceId` so this manager never has to listen to the WorkspaceManager.
 * Deletion is soft (a recoverable trash via `deleted_at`) with restore + purge.
 */
import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { SESSION_DEFAULTS } from '@shared/constants';
import type {
  Session,
  SessionPermissionMode,
  SessionStatus,
  SessionTimelineEntry,
  SessionUpdate,
  WorktreeStatus,
} from '@shared/types';
import { getDb } from '../db/database';
import { logger } from '../logger';

interface SessionRow {
  id: string;
  workspace_id: string;
  title: string;
  branch: string;
  status: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  adds: number;
  dels: number;
  unread: number;
  mode: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_status: string | null;
  base_ref: string | null;
  folder: string | null;
  tags: string | null;
}

const ACTIVE_KEY = 'activeSessionId';

/** Fields the WorktreeManager persists onto a session after worktree ops. */
export interface SessionWorktreePatch {
  worktreePath: string | null;
  worktreeBranch: string | null;
  worktreeStatus: WorktreeStatus;
  baseRef?: string | null;
}

export class SessionManager {
  private get db(): Database.Database {
    return getDb();
  }

  /**
   * In-process subscribers notified when the *effective execution root* of the
   * app may have changed — the active session switched, or the active session's
   * worktree was created / removed / went missing. Mirrors
   * WorkspaceManager.onActiveChanged; used to retarget the file watcher, git
   * root cache, and search index at the active session's worktree.
   */
  private activeListeners = new Set<(session: Session | null) => void>();
  /** Last `id:worktreePath:worktreeStatus` broadcast, to emit only real changes. */
  private lastActiveKey: string | null = null;

  onActiveChanged(cb: (session: Session | null) => void): () => void {
    this.activeListeners.add(cb);
    return () => this.activeListeners.delete(cb);
  }

  /* -------------------------------------------------------------- reads */

  /**
   * Live (non-deleted) sessions for a workspace, pinned first then most-recent.
   * Archived sessions are included so the renderer can group/hide them; deleted
   * (trashed) sessions are returned only by {@link listTrash}.
   */
  list(workspaceId: string): Session[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
          WHERE workspace_id = ? AND deleted_at IS NULL
          ORDER BY pinned DESC, updated_at DESC`,
      )
      .all(workspaceId) as SessionRow[];
    return rows.map(rowToSession);
  }

  /** Soft-deleted sessions for a workspace (the recoverable trash). */
  listTrash(workspaceId: string): Session[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
          WHERE workspace_id = ? AND deleted_at IS NOT NULL
          ORDER BY deleted_at DESC`,
      )
      .all(workspaceId) as SessionRow[];
    return rows.map(rowToSession);
  }

  getActive(): Session | null {
    const id = this.activeId();
    if (!id) return null;
    return this.byId(id);
  }

  /** Public by-id lookup (used by the WorktreeManager / ServiceManager). */
  get(id: string): Session | null {
    return this.byId(id);
  }

  /* ------------------------------------------------------------- writes */

  /** Create a new session inside a workspace and make it active. */
  create(workspaceId: string, title?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      workspaceId,
      title: (title ?? SESSION_DEFAULTS.title).trim() || SESSION_DEFAULTS.title,
      branch: SESSION_DEFAULTS.branch,
      status: SESSION_DEFAULTS.status as SessionStatus,
      createdAt: now,
      updatedAt: now,
      adds: 0,
      dels: 0,
      unread: 0,
      pinned: false,
      archived: false,
      deletedAt: null,
      worktreePath: null,
      worktreeBranch: null,
      worktreeStatus: 'none',
      baseRef: null,
      folder: null,
      tags: [],
    };

    this.db
      .prepare(
        `INSERT INTO sessions
          (id, workspace_id, title, branch, status, created_at, updated_at, pinned, archived, deleted_at, adds, dels, unread, mode)
         VALUES (@id, @workspace_id, @title, @branch, @status, @created_at, @updated_at, @pinned, @archived, @deleted_at, @adds, @dels, @unread, @mode)`,
      )
      .run({
        id: session.id,
        workspace_id: session.workspaceId,
        title: session.title,
        branch: session.branch,
        status: session.status,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        pinned: 0,
        archived: 0,
        deleted_at: null,
        adds: 0,
        dels: 0,
        unread: 0,
        mode: null,
      });

    this.setActive(session.id, false);
    logger.info(`Session created: ${session.title} (${session.id})`);
    this.broadcast();
    return session;
  }

  /** Merge a partial patch — rename / pin / archive / organize. Bumps `updated_at`. */
  update(id: string, patch: SessionUpdate): Session {
    const current = this.requireById(id);
    const next: Session = {
      ...current,
      title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
      pinned: patch.pinned !== undefined ? patch.pinned : current.pinned,
      archived: patch.archived !== undefined ? patch.archived : current.archived,
      folder:
        patch.folder !== undefined ? (patch.folder ? patch.folder.trim() || null : null) : current.folder,
      tags: patch.tags !== undefined ? patch.tags : current.tags,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE sessions SET title = ?, pinned = ?, archived = ?, folder = ?, tags = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.title,
        next.pinned ? 1 : 0,
        next.archived ? 1 : 0,
        next.folder,
        JSON.stringify(next.tags),
        next.updatedAt,
        id,
      );
    this.broadcast();
    return next;
  }

  /**
   * Persist a session's worktree association (called only by the
   * WorktreeManager after a real `git worktree` operation). Does NOT bump
   * `updated_at` for status-only transitions so recovery sweeps don't reorder
   * the sidebar.
   */
  setWorktree(id: string, patch: SessionWorktreePatch): Session {
    const current = this.requireById(id);
    this.db
      .prepare(
        `UPDATE sessions SET worktree_path = ?, worktree_branch = ?, worktree_status = ?, base_ref = ? WHERE id = ?`,
      )
      .run(
        patch.worktreePath,
        patch.worktreeBranch,
        patch.worktreeStatus,
        patch.baseRef !== undefined ? patch.baseRef : current.baseRef,
        id,
      );
    this.broadcast();
    return this.requireById(id);
  }

  /**
   * Clone a session under a new id, carrying over its agent transcript so the
   * duplicate resumes with identical history. Both diverge independently after.
   */
  duplicate(id: string): Session {
    const src = this.requireById(id);
    const now = Date.now();
    const copy: Session = {
      ...src,
      id: crypto.randomUUID(),
      title: `${src.title} (copy)`,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      deletedAt: null,
      // The clone never shares the source's worktree directory — resuming two
      // agents in one working tree defeats the isolation model. The caller may
      // provision a fresh worktree from the same base afterwards.
      worktreePath: null,
      worktreeBranch: null,
      worktreeStatus: 'none',
    };

    const clone = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions
            (id, workspace_id, title, branch, status, created_at, updated_at, pinned, archived, deleted_at, adds, dels, unread, mode, base_ref, folder, tags)
           VALUES (@id, @workspace_id, @title, @branch, @status, @created_at, @updated_at, @pinned, @archived, @deleted_at, @adds, @dels, @unread, @mode, @base_ref, @folder, @tags)`,
        )
        .run({
          id: copy.id,
          workspace_id: copy.workspaceId,
          title: copy.title,
          branch: copy.branch,
          status: copy.status,
          created_at: copy.createdAt,
          updated_at: copy.updatedAt,
          pinned: 0,
          archived: copy.archived ? 1 : 0,
          deleted_at: null,
          adds: copy.adds,
          dels: copy.dels,
          unread: 0,
          mode: copy.mode ?? null,
          base_ref: copy.baseRef,
          folder: copy.folder,
          tags: JSON.stringify(copy.tags),
        });

      // Copy the transcript / activity so the clone opens with the same history.
      // New row ids; same created_at ordering preserved.
      this.db
        .prepare(
          `INSERT INTO agent_messages (id, session_id, role, text, created_at)
             SELECT lower(hex(randomblob(16))), ?, role, text, created_at
               FROM agent_messages WHERE session_id = ?`,
        )
        .run(copy.id, src.id);
      this.db
        .prepare(
          `INSERT INTO agent_activity (id, session_id, type, payload, created_at)
             SELECT lower(hex(randomblob(16))), ?, type, payload, created_at
               FROM agent_activity WHERE session_id = ?`,
        )
        .run(copy.id, src.id);
      // The SDK session id is NOT copied: the clone starts a fresh agent thread
      // while preserving the visible transcript (resuming the same SDK session
      // from two places would interleave turns).
    });
    clone();

    this.setActive(copy.id, false);
    logger.info(`Session duplicated: ${src.id} -> ${copy.id}`);
    this.broadcast();
    return copy;
  }

  /** Move a session to the recoverable trash. Re-picks the active session. */
  softDelete(id: string): void {
    const session = this.byId(id);
    if (!session) return;
    this.db
      .prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(Date.now(), Date.now(), id);
    if (this.activeId() === id) {
      const next = this.list(session.workspaceId)[0] ?? null;
      if (next) this.setActive(next.id, false);
      else this.clearActive(false);
    }
    this.broadcast();
  }

  /** Restore a trashed session back to the live list. */
  restore(id: string): Session {
    this.db
      .prepare('UPDATE sessions SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
    this.broadcast();
    return this.requireById(id);
  }

  /** Permanently remove a session and all of its agent data. Irreversible. */
  purge(id: string): void {
    const purgeAll = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_messages WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM agent_activity WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM agent_session_meta WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM agent_provider_sessions WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM agent_diagnostics WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
    purgeAll();
    if (this.activeId() === id) this.clearActive(false);
    logger.info(`Session purged: ${id}`);
    this.broadcast();
  }

  /** Make a session the active one (a coordinated switch the renderer mirrors). */
  setActive(id: string, broadcast = true): Session {
    const session = this.requireById(id);
    this.db
      .prepare(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(ACTIVE_KEY, id);
    // Opening a session reads its messages — clear its unread badge.
    this.db.prepare('UPDATE sessions SET unread = 0 WHERE id = ? AND unread != 0').run(id);
    if (broadcast) this.broadcast();
    return session;
  }

  /**
   * Persist the last composer permission mode used for a session (drives the
   * mode selector on reopen). Does NOT bump `updated_at` — it is UI state.
   */
  setMode(id: string, mode: SessionPermissionMode): void {
    const info = this.db
      .prepare('UPDATE sessions SET mode = ? WHERE id = ? AND (mode IS NULL OR mode != ?)')
      .run(mode, id, mode);
    if (info.changes > 0) this.broadcast();
  }

  /**
   * Increment a session's unread count when new assistant output lands while the
   * session is NOT the active one. No-op for the active session (it's on screen)
   * and does not reorder the list (no `updated_at` bump).
   */
  bumpUnread(id: string): void {
    if (this.activeId() === id) return;
    const info = this.db.prepare('UPDATE sessions SET unread = unread + 1 WHERE id = ?').run(id);
    if (info.changes > 0) this.broadcast();
  }

  /**
   * Apply the workspace's live git status (current branch + working-tree diff) to
   * every live session in that workspace. Does NOT bump `updated_at` (git changes
   * must not reorder the recency-sorted list), and only broadcasts when a value
   * actually changed so the watcher can fire freely without UI churn.
   */
  applyGitStatus(
    workspaceId: string,
    status: { branch?: string; adds: number; dels: number },
  ): void {
    const branch = status.branch ?? SESSION_DEFAULTS.branch;
    // Worktree-backed sessions track their OWN branch/diff (stamped via
    // applySessionGitStatus from their own root) — never overwrite them with
    // the shared workspace checkout's status.
    const info = this.db
      .prepare(
        `UPDATE sessions SET branch = ?, adds = ?, dels = ?
          WHERE workspace_id = ? AND deleted_at IS NULL AND worktree_path IS NULL
            AND (branch != ? OR adds != ? OR dels != ?)`,
      )
      .run(branch, status.adds, status.dels, workspaceId, branch, status.adds, status.dels);
    if (info.changes > 0) this.broadcast();
  }

  /**
   * Apply live git status from a *worktree* to the single session that owns it
   * (the worktree checkout has its own branch + diff, independent of the
   * workspace checkout). Same no-reorder / no-churn semantics as
   * {@link applyGitStatus}.
   */
  applySessionGitStatus(
    sessionId: string,
    status: { branch?: string; adds: number; dels: number },
  ): void {
    const branch = status.branch ?? SESSION_DEFAULTS.branch;
    const info = this.db
      .prepare(
        `UPDATE sessions SET branch = ?, adds = ?, dels = ?
          WHERE id = ? AND deleted_at IS NULL
            AND (branch != ? OR adds != ? OR dels != ?)`,
      )
      .run(branch, status.adds, status.dels, sessionId, branch, status.adds, status.dels);
    if (info.changes > 0) this.broadcast();
  }

  /**
   * The session's unified engineering timeline — activity feed, diagnostics,
   * and git checkpoints merged chronologically, plus synthetic lifecycle rows.
   * Derived by query over the already-persisted tables (no duplicate storage,
   * so it can never drift from its sources). Most recent first.
   */
  getTimeline(sessionId: string, limit = 200): SessionTimelineEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, 'activity' AS kind, type AS label, payload AS detail, created_at
           FROM agent_activity WHERE session_id = ?
         UNION ALL
         SELECT id, 'diagnostic' AS kind, label, detail, created_at
           FROM agent_diagnostics WHERE session_id = ?
         UNION ALL
         SELECT id, 'checkpoint' AS kind, label, files AS detail, created_at
           FROM git_checkpoints WHERE session_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, sessionId, sessionId, limit) as Array<{
      id: string;
      kind: SessionTimelineEntry['kind'];
      label: string;
      detail: string | null;
      created_at: number;
    }>;

    const entries: SessionTimelineEntry[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      detail: r.detail ?? undefined,
      at: r.created_at,
    }));

    const session = this.byId(sessionId);
    if (session) {
      entries.push({
        id: `${sessionId}:created`,
        kind: 'lifecycle',
        label: 'Session created',
        at: session.createdAt,
      });
      if (session.archived) {
        entries.push({
          id: `${sessionId}:archived`,
          kind: 'lifecycle',
          label: 'Session archived',
          at: session.updatedAt,
        });
      }
    }
    entries.sort((a, b) => b.at - a.at);
    return entries.slice(0, limit);
  }

  /**
   * Derive a session's title from its first message — but only while the title is
   * still the untouched default, so a user rename is never clobbered.
   */
  autoTitle(sessionId: string, text: string): void {
    const title = deriveTitle(text);
    if (!title) return;
    const info = this.db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND title = ?')
      .run(title, Date.now(), sessionId, SESSION_DEFAULTS.title);
    if (info.changes > 0) {
      logger.info(`Session auto-titled: ${sessionId} -> ${title}`);
      this.broadcast();
    }
  }

  /* -------------------------------------------------------- internals */

  private byId(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? rowToSession(row) : null;
  }

  private requireById(id: string): Session {
    const session = this.byId(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  private activeId(): string | null {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(ACTIVE_KEY) as
      | { value: string | null }
      | undefined;
    return row?.value ?? null;
  }

  private clearActive(broadcast = true): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(ACTIVE_KEY);
    if (broadcast) this.broadcast();
  }

  private broadcast(): void {
    const active = this.getActive();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      // The list payload is workspace-scoped, so the renderer re-requests it per
      // active workspace; here we just signal "something changed" + the active id.
      win.webContents.send(IpcEvents.sessionsUpdated);
      win.webContents.send(IpcEvents.sessionActiveChanged, active);
    }

    // Notify in-process listeners only when the active session's execution root
    // could actually differ (switch, worktree created/removed/missing) so the
    // watcher/index/git retarget path never churns on unrelated broadcasts.
    const key = active
      ? `${active.id}:${active.worktreePath ?? ''}:${active.worktreeStatus}`
      : null;
    if (key !== this.lastActiveKey) {
      this.lastActiveKey = key;
      for (const cb of this.activeListeners) {
        try {
          cb(active);
        } catch (err) {
          logger.warn('session active-changed listener failed', err);
        }
      }
    }
  }
}

/** First non-empty line of a prompt, whitespace-collapsed and capped for a title. */
function deriveTitle(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > 50 ? `${collapsed.slice(0, 50).trimEnd()}…` : collapsed;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    branch: row.branch,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adds: row.adds,
    dels: row.dels,
    unread: row.unread,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    deletedAt: row.deleted_at,
    mode: coerceMode(row.mode),
    worktreePath: row.worktree_path,
    worktreeBranch: row.worktree_branch,
    worktreeStatus: coerceWorktreeStatus(row.worktree_status),
    baseRef: row.base_ref,
    folder: row.folder,
    tags: parseTags(row.tags),
  };
}

function coerceWorktreeStatus(value: string | null): WorktreeStatus {
  if (
    value === 'creating' ||
    value === 'ready' ||
    value === 'missing' ||
    value === 'removing'
  ) {
    return value;
  }
  return 'none';
}

/** Parse the persisted JSON tags column defensively (never throws). */
function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/**
 * Map a persisted `sessions.mode` string to a {@link SessionPermissionMode}. The
 * column predates the harness-aligned modes, so coerce the legacy `implement`
 * value to `default` and drop anything unrecognized.
 */
function coerceMode(value: string | null): SessionPermissionMode | undefined {
  if (value === 'plan' || value === 'ask' || value === 'default' || value === 'acceptEdits') return value;
  if (value === 'implement') return 'default';
  return undefined;
}
