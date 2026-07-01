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
  SessionUpdate,
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
}

const ACTIVE_KEY = 'activeSessionId';

export class SessionManager {
  private get db(): Database.Database {
    return getDb();
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

  /** Merge a partial patch — rename / pin / archive. Bumps `updated_at`. */
  update(id: string, patch: SessionUpdate): Session {
    const current = this.requireById(id);
    const next: Session = {
      ...current,
      title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
      pinned: patch.pinned !== undefined ? patch.pinned : current.pinned,
      archived: patch.archived !== undefined ? patch.archived : current.archived,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE sessions SET title = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?`,
      )
      .run(next.title, next.pinned ? 1 : 0, next.archived ? 1 : 0, next.updatedAt, id);
    this.broadcast();
    return next;
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
    };

    const clone = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions
            (id, workspace_id, title, branch, status, created_at, updated_at, pinned, archived, deleted_at, adds, dels, unread, mode)
           VALUES (@id, @workspace_id, @title, @branch, @status, @created_at, @updated_at, @pinned, @archived, @deleted_at, @adds, @dels, @unread, @mode)`,
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
    const info = this.db
      .prepare(
        `UPDATE sessions SET branch = ?, adds = ?, dels = ?
          WHERE workspace_id = ? AND deleted_at IS NULL
            AND (branch != ? OR adds != ? OR dels != ?)`,
      )
      .run(branch, status.adds, status.dels, workspaceId, branch, status.adds, status.dels);
    if (info.changes > 0) this.broadcast();
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
  };
}

/**
 * Map a persisted `sessions.mode` string to a {@link SessionPermissionMode}. The
 * column predates the harness-aligned modes, so coerce the legacy `implement`
 * value to `default` and drop anything unrecognized.
 */
function coerceMode(value: string | null): SessionPermissionMode | undefined {
  if (value === 'plan' || value === 'default' || value === 'acceptEdits') return value;
  if (value === 'implement') return 'default';
  return undefined;
}
