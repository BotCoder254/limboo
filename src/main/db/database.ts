/**
 * Local SQLite database — the on-device persistence layer for Limboo.
 *
 * Owned entirely by the main process (never the renderer). Opened once as a
 * singleton under `userData`. Security contract (CLAUDE.md §6): callers use only
 * prepared statements with *bound parameters* — values are never concatenated or
 * interpolated into SQL. WAL mode keeps reads fast and writes durable.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import { logger } from '../logger';
import { WORKSPACE_SCHEMA_VERSION } from '@shared/constants';

let db: Database.Database | null = null;

/** Open (or return the already-open) database and ensure the schema exists. */
export function getDb(): Database.Database {
  if (db) return db;

  const file = path.join(app.getPath('userData'), 'limboo.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  logger.info(`SQLite opened at ${file}`);
  return db;
}

/** Close the database. Called on app quit. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Add a column to a table if it isn't already present (idempotent migration). */
function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  logger.info(`DB migration: added ${table}.${column}`);
}

/** Create tables on first run and record the schema version for future upgrades. */
function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      path           TEXT NOT NULL UNIQUE,
      icon           TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL,
      favorite       INTEGER NOT NULL DEFAULT 0,
      lifecycle      TEXT NOT NULL,
      health         TEXT NOT NULL,
      metadata       TEXT NOT NULL,
      config         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Persisted development sessions (Phase 3). Every session belongs to a
    -- workspace; deleted_at is NULL for live sessions and set when moved to the
    -- recoverable trash. The agent_* tables key off session_id for transcript.
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title        TEXT NOT NULL,
      branch       TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      archived     INTEGER NOT NULL DEFAULT 0,
      deleted_at   INTEGER,
      adds         INTEGER NOT NULL DEFAULT 0,
      dels         INTEGER NOT NULL DEFAULT 0,
      unread       INTEGER NOT NULL DEFAULT 0,
      mode         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace
      ON sessions (workspace_id, pinned DESC, updated_at DESC);

    -- Agent conversation history, persisted per session so a reopened session
    -- restores its transcript. Append-only.
    CREATE TABLE IF NOT EXISTS agent_messages (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session
      ON agent_messages (session_id, created_at);

    -- Immutable, audit-style activity feed (tool calls, file changes, results).
    CREATE TABLE IF NOT EXISTS agent_activity (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      type        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_activity_session
      ON agent_activity (session_id, created_at);

    -- Maps a Limboo session to its Claude Code SDK session id so multi-turn
    -- conversations resume across prompts.
    CREATE TABLE IF NOT EXISTS agent_session_meta (
      session_id     TEXT PRIMARY KEY,
      sdk_session_id TEXT,
      updated_at     INTEGER NOT NULL
    );

    -- Structured diagnostics console — the lifecycle / request / recovery /
    -- heartbeat timeline. session_id is nullable for capability-global events.
    CREATE TABLE IF NOT EXISTS agent_diagnostics (
      id          TEXT PRIMARY KEY,
      session_id  TEXT,
      severity    TEXT NOT NULL,
      category    TEXT NOT NULL,
      label       TEXT NOT NULL,
      detail      TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_diagnostics_session
      ON agent_diagnostics (session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_diagnostics_created
      ON agent_diagnostics (created_at);

    -- Plan Mode artifacts — one proposed implementation strategy per session,
    -- persisted so an unfinished/awaiting-approval plan survives an app restart.
    -- meta is JSON-serialized PlanMeta; markdown is the raw plan from ExitPlanMode.
    CREATE TABLE IF NOT EXISTS agent_plans (
      session_id  TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      title       TEXT NOT NULL,
      markdown    TEXT NOT NULL,
      meta        TEXT NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      approved_at INTEGER,
      updated_at  INTEGER NOT NULL
    );

    -- Git checkpoints — lightweight, session-scoped recovery points stored as
    -- dedicated git refs (refs/limboo/checkpoints/<sessionId>/<ts>); this table
    -- holds only the metadata + which ref to restore. Never on a branch, never
    -- pushed. Soft history of an agent's work, separate from real commits.
    CREATE TABLE IF NOT EXISTS git_checkpoints (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      ref           TEXT NOT NULL,
      commit_hash   TEXT NOT NULL,
      label         TEXT NOT NULL,
      auto          INTEGER NOT NULL DEFAULT 0,
      message_id    TEXT,
      files         TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_git_checkpoints_session
      ON git_checkpoints (session_id, created_at DESC);
  `);

  // Idempotent column additions for databases created before a column existed.
  // (SQLite has no "ADD COLUMN IF NOT EXISTS"; guard against the existing set.)
  addColumnIfMissing(database, 'sessions', 'mode', 'TEXT');

  const current = database
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;

  if (!current) {
    database
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(WORKSPACE_SCHEMA_VERSION));
  } else if (Number(current.value) !== WORKSPACE_SCHEMA_VERSION) {
    logger.info(
      `Workspace schema v${current.value} -> v${WORKSPACE_SCHEMA_VERSION} (migrations run here)`,
    );
    database
      .prepare('UPDATE meta SET value = ? WHERE key = ?')
      .run(String(WORKSPACE_SCHEMA_VERSION), 'schema_version');
  }
}
