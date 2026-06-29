# Subsystem: Session Manager

## Purpose

A session is the unit of work; the Session Manager owns its lifecycle and persists
it. It is what lets you leave and return to a unit of intent without losing the
conversation, the activity, or the mode. See the
[Sessions concept](../../concepts/sessions.md).

Source: [`src/main/managers/SessionManager.ts`](../../../src/main/managers/SessionManager.ts).

## Responsibilities

- Create, list, switch, update, duplicate, and trash sessions.
- Track the active session and its unread count.
- Remember per-session mode (plan / implement).
- Accept live git status for session rows; auto-title from the first prompt.

## Storage

The `sessions` table holds id, workspace_id, title, branch, status, created_at,
updated_at, pinned, archived, deleted_at (soft delete), adds, dels, unread, and mode.
See [the database](database.md).

## Public surface (key methods)

- `list(workspaceId)` (live; pinned first, then most recent), `listTrash(workspaceId)`
- `getActive()`, `setActive(id)`, `create(workspaceId, title?)`, `update(id, patch)`
- `duplicate(id)` (clones transcript + activity, new SDK session id)
- `softDelete(id)`, `restore(id)`, `purge(id)`
- `setMode(id, mode)` (UI state; no `updated_at` bump)
- `bumpUnread(id)`, `applyGitStatus(workspaceId, {branch, adds, dels})`,
  `autoTitle(sessionId, text)`

Reached via the `session:*` channels.

## Dependencies and wiring

- The **Agent Manager** calls `autoTitle` from the first prompt and drives unread.
- The **File System Layer** calls `applyGitStatus` so session rows show live branch
  and diff counts (deduped, no `updated_at` bump).

## Data flow

Changes broadcast two events: `sessions:updated` (the list changed) and
`session:active-changed` (with the new active session). `useSessionStore` consumes
both and follows workspace switches.

## Security boundary

Renderer-supplied titles and ids are length-capped (`SESSION_LIMITS`). Soft delete
keeps a recovery window before `purge`.

## Planned

No standalone gaps; session features evolve with the agent and git subsystems.
