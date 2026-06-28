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
  `);

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
