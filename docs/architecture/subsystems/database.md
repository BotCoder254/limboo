# Subsystem: Database

## Purpose

The local database is the durable backbone that makes sessions recoverable across
restarts. It is owned exclusively by the main process — the renderer never touches it
— and it is the single store for workspaces, sessions, transcripts, memories, and
checkpoints. See [Local-first](../../concepts/local-first.md).

Source: [`src/main/db/database.ts`](../../../src/main/db/database.ts).

## Engine and configuration

- `better-sqlite3` at `{userData}/limboo.db`.
- Opened once as a singleton (`getDb()`), closed on quit (`closeDb()`).
- Pragmas: `journal_mode = WAL` (write-ahead logging) and `foreign_keys = ON`.

## Schema

Fourteen tables plus the FTS triggers:

| Table | Holds |
| ----- | ----- |
| `meta` | schema version tracking |
| `workspaces` | registered workspaces (name, path, icon, metadata, config) |
| `app_state` | singleton: active workspace / session ids |
| `sessions` | development sessions per workspace |
| `agent_messages` | conversation history (append-only user / assistant turns) |
| `agent_activity` | the agent audit feed |
| `agent_session_meta` | Limboo session -> SDK session id (multi-turn resume) |
| `agent_diagnostics` | lifecycle / request / recovery / heartbeat timeline (swept) |
| `agent_plans` | Plan Mode artifacts (status, markdown, meta, timestamps) |
| `git_checkpoints` | checkpoint metadata (session-scoped recovery points) |
| `memories` | durable project knowledge (tier, source, confidence, status, expiry) |
| `memories_fts` | FTS5 virtual table over memory title + body |
| `memory_links` | back-links from a memory to its source |

The `memories_fts` table is kept in sync with `memories` by insert / update / delete
triggers.

## Migrations

The schema version is tracked in `meta`. Migrations are idempotent (SQLite lacks
`ADD COLUMN IF NOT EXISTS`, so additions are applied defensively); on a version
mismatch the migration runs and the version is updated. The workspace schema version
is tracked separately (`WORKSPACE_SCHEMA_VERSION` in
[`constants.ts`](../../../src/shared/constants.ts)).

## Access contract

**Only prepared statements with bound parameters.** Values are never concatenated or
interpolated into SQL. Callers use `.prepare(sql).run(values)` / `.all(values)`. As
defense in depth, handlers reject prototype-polluting keys before any insert /
update. See [the security model](../security-model.md).

## Ownership

Every manager that persists state (Session, Workspace, Git checkpoints, Agent,
Memory) reads and writes through this database. Because it is opened before any
manager that uses it and closed on `before-quit`, the lifecycle is deterministic; see
[the main process](../main-process.md).
