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
    -- conversations resume across prompts. Superseded by
    -- agent_provider_sessions (schema v12) — kept for backfill, no longer
    -- written.
    CREATE TABLE IF NOT EXISTS agent_session_meta (
      session_id     TEXT PRIMARY KEY,
      sdk_session_id TEXT,
      updated_at     INTEGER NOT NULL
    );

    -- Provider-keyed resume tokens (schema v12) — one row per (session,
    -- provider) so a Limboo session can hold a Claude SDK session id and a
    -- Cursor chat id side by side. The backfill below migrates legacy rows
    -- once; INSERT OR IGNORE keeps it idempotent across boots.
    CREATE TABLE IF NOT EXISTS agent_provider_sessions (
      session_id          TEXT NOT NULL,
      provider            TEXT NOT NULL,
      provider_session_id TEXT,
      updated_at          INTEGER NOT NULL,
      PRIMARY KEY (session_id, provider)
    );
    INSERT OR IGNORE INTO agent_provider_sessions
      (session_id, provider, provider_session_id, updated_at)
      SELECT session_id, 'anthropic', sdk_session_id, updated_at
        FROM agent_session_meta;

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

    -- Plan revisions — historical snapshots of a session's plan, captured on each
    -- regenerate / re-capture so iterative planning cycles can be compared and
    -- restored. Additive to agent_plans (which always holds the current plan).
    CREATE TABLE IF NOT EXISTS plan_revisions (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      rev         INTEGER NOT NULL,
      status      TEXT NOT NULL,
      title       TEXT NOT NULL,
      markdown    TEXT NOT NULL,
      meta        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plan_revisions_session
      ON plan_revisions (session_id, rev DESC);

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

    -- Resume Pipeline (schema v10) — one repository anchor per session,
    -- upserted at meaningful moments (run end, checkpoint, deactivation).
    -- head/branch are NULL when the effective root is not a git repo (or the
    -- branch is detached). dirty_files is a capped JSON array of {path,status};
    -- dirty_hash is a sha256 over the sorted dirty entries
    -- (status|path|size|mtimeMs) so content drift in an already-dirty tree is
    -- detected without ever reading file contents. All values bound.
    CREATE TABLE IF NOT EXISTS session_snapshots (
      session_id   TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      root         TEXT NOT NULL,
      head         TEXT,
      branch       TEXT,
      dirty_hash   TEXT NOT NULL DEFAULT '',
      dirty_files  TEXT NOT NULL DEFAULT '[]',
      reason       TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    -- The last computed repository delta per session, persisted so the
    -- one-shot prompt injection survives an app restart between detection and
    -- the next prompt. status: 'pending' | 'injected' | 'dismissed'.
    -- delta is a JSON RepoDelta built entirely in the main process.
    CREATE TABLE IF NOT EXISTS resume_deltas (
      session_id TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      delta      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Local Memory System — durable, provider-independent project knowledge.
    -- workspace_id is NULL for global/user-scope memories (e.g. preferences).
    -- Only rows with status='active' are ever injected into an agent prompt;
    -- 'proposed' rows await user confirmation. All values are bound, never
    -- string-interpolated. meta is a JSON blob (validated before write).
    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT,
      tier          TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      source        TEXT NOT NULL,
      confidence    REAL NOT NULL DEFAULT 0.5,
      pinned        INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'active',
      use_count     INTEGER NOT NULL DEFAULT 0,
      last_used_at  INTEGER,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      expires_at    INTEGER,
      session_id    TEXT,
      commit_hash   TEXT,
      file_path     TEXT,
      meta          TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_memories_workspace
      ON memories (workspace_id, status, tier);
    CREATE INDEX IF NOT EXISTS idx_memories_status
      ON memories (status, updated_at DESC);

    -- Full-text index over title+body for BM25 keyword retrieval (offline). It
    -- shadows the memories table via content='memories' and is kept in sync by
    -- the triggers below.
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, body, content='memories', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;

    -- Back-links from a memory to the conversation / commit / file / memory it
    -- originated from, so the UI can navigate to the source.
    CREATE TABLE IF NOT EXISTS memory_links (
      memory_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      ref       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_links_memory
      ON memory_links (memory_id);

    -- Search Engine — the app-owned index of workspace files. One row per indexed
    -- file, scoped by workspace. Content is bounded (head of file, text only) and
    -- read solely through the guarded file reader. All values are bound, never
    -- string-interpolated. The FTS5 shadow below powers BM25 keyword retrieval.
    CREATE TABLE IF NOT EXISTS search_files (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      path         TEXT NOT NULL,
      lang         TEXT,
      size         INTEGER NOT NULL DEFAULT 0,
      content      TEXT NOT NULL DEFAULT '',
      updated_at   INTEGER NOT NULL,
      UNIQUE (workspace_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_search_files_workspace
      ON search_files (workspace_id, updated_at DESC);

    -- Full-text index over path + content (default unicode tokenizer → BM25).
    -- Shadows search_files via content='search_files'; kept in sync by triggers.
    CREATE VIRTUAL TABLE IF NOT EXISTS search_files_fts USING fts5(
      path, content, content='search_files', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS search_files_ai AFTER INSERT ON search_files BEGIN
      INSERT INTO search_files_fts(rowid, path, content)
        VALUES (new.rowid, new.path, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS search_files_ad AFTER DELETE ON search_files BEGIN
      INSERT INTO search_files_fts(search_files_fts, rowid, path, content)
        VALUES ('delete', old.rowid, old.path, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS search_files_au AFTER UPDATE ON search_files BEGIN
      INSERT INTO search_files_fts(search_files_fts, rowid, path, content)
        VALUES ('delete', old.rowid, old.path, old.content);
      INSERT INTO search_files_fts(rowid, path, content)
        VALUES (new.rowid, new.path, new.content);
    END;

    -- Language-aware symbol index (best-effort, regex-extracted during indexing).
    -- One row per declaration; navigable via path + line.
    CREATE TABLE IF NOT EXISTS search_symbols (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      path         TEXT NOT NULL,
      name         TEXT NOT NULL,
      kind         TEXT NOT NULL,
      lang         TEXT,
      line         INTEGER NOT NULL DEFAULT 1,
      signature    TEXT NOT NULL DEFAULT '',
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_symbols_workspace
      ON search_symbols (workspace_id, name);
    CREATE INDEX IF NOT EXISTS idx_search_symbols_path
      ON search_symbols (workspace_id, path);

    -- Trigram tokenizer → substring + fuzzy matching on symbol names/signatures
    -- (built into FTS5 since 3.34; substrings <3 chars fall back to a LIKE scan).
    CREATE VIRTUAL TABLE IF NOT EXISTS search_symbols_fts USING fts5(
      name, signature, content='search_symbols', content_rowid='rowid',
      tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS search_symbols_ai AFTER INSERT ON search_symbols BEGIN
      INSERT INTO search_symbols_fts(rowid, name, signature)
        VALUES (new.rowid, new.name, new.signature);
    END;
    CREATE TRIGGER IF NOT EXISTS search_symbols_ad AFTER DELETE ON search_symbols BEGIN
      INSERT INTO search_symbols_fts(search_symbols_fts, rowid, name, signature)
        VALUES ('delete', old.rowid, old.name, old.signature);
    END;
    CREATE TRIGGER IF NOT EXISTS search_symbols_au AFTER UPDATE ON search_symbols BEGIN
      INSERT INTO search_symbols_fts(search_symbols_fts, rowid, name, signature)
        VALUES ('delete', old.rowid, old.name, old.signature);
      INSERT INTO search_symbols_fts(rowid, name, signature)
        VALUES (new.rowid, new.name, new.signature);
    END;

    -- Attachment Manager (schema v9) — session-owned files attached in the
    -- composer. The staged copy lives under userData/attachments/<session_id>/
    -- <stored_name>; this table is the metadata + lifecycle record. message_id
    -- is NULL while the attachment is a composer draft and set when it is sent
    -- with a user turn. Deduped per session by content hash. All values bound.
    CREATE TABLE IF NOT EXISTS attachments (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name         TEXT NOT NULL,
      stored_name  TEXT NOT NULL,
      mime         TEXT NOT NULL,
      category     TEXT NOT NULL,
      size         INTEGER NOT NULL,
      sha256       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ready',
      origin       TEXT NOT NULL,
      risk         TEXT NOT NULL DEFAULT 'safe',
      message_id   TEXT,
      thumb        TEXT,
      error        TEXT,
      meta         TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_session
      ON attachments (session_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_dedupe
      ON attachments (session_id, sha256);

    -- Recent searches (most-recent-first) per scope. workspace_id NULL = global.
    CREATE TABLE IF NOT EXISTS search_history (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT,
      query        TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_history_scope
      ON search_history (workspace_id, created_at DESC);

    -- Named, re-runnable saved searches. filter is a JSON blob (validated on write).
    CREATE TABLE IF NOT EXISTS saved_searches (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT,
      name         TEXT NOT NULL,
      query        TEXT NOT NULL,
      filter       TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_searches_scope
      ON saved_searches (workspace_id, created_at DESC);

    -- Lightweight dependency / reference layer (schema v11) — one row per
    -- import/require/use edge, extracted by regex during the same indexing pass
    -- that owns search_symbols. Parser-agnostic: a future tree-sitter extractor
    -- can repopulate the same columns without a schema change. The ref column is
    -- the raw module specifier; ref_path is the workspace-relative resolution
    -- when the specifier is relative (NULL for bare/package specifiers). Bounded
    -- per file by SEARCH_LIMITS. All values bound, never string-interpolated.
    CREATE TABLE IF NOT EXISTS search_refs (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      src_path     TEXT NOT NULL,
      ref          TEXT NOT NULL,
      ref_path     TEXT,
      kind         TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_refs_src
      ON search_refs (workspace_id, src_path);
    CREATE INDEX IF NOT EXISTS idx_search_refs_target
      ON search_refs (workspace_id, ref_path);
  `);

  // Idempotent column additions for databases created before a column existed.
  // (SQLite has no "ADD COLUMN IF NOT EXISTS"; guard against the existing set.)
  addColumnIfMissing(database, 'sessions', 'mode', 'TEXT');
  // Worktree-backed sessions (schema v8) — a session may own an isolated git
  // worktree (own directory + branch). worktree_status: 'none'|'creating'|
  // 'ready'|'missing'|'removing'. base_ref is the branch/commit the worktree
  // branch was created from (used for recreate/duplicate). folder + tags are
  // user organization (tags is a JSON string array, validated before write).
  addColumnIfMissing(database, 'sessions', 'worktree_path', 'TEXT');
  addColumnIfMissing(database, 'sessions', 'worktree_branch', 'TEXT');
  addColumnIfMissing(database, 'sessions', 'worktree_status', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(database, 'sessions', 'base_ref', 'TEXT');
  addColumnIfMissing(database, 'sessions', 'folder', 'TEXT');
  addColumnIfMissing(database, 'sessions', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  // Code Intelligence (schema v11) — a content hash per indexed file so the
  // incremental pass can skip files whose bytes are unchanged (no FTS churn)
  // and the resume delta engine can detect real content change. Path-only rows
  // (binary/oversize) store a cheap "size:mtimeMs" surrogate instead.
  addColumnIfMissing(database, 'search_files', 'content_hash', "TEXT NOT NULL DEFAULT ''");

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
