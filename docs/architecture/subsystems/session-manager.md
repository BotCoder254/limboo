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
- Carry each session's worktree association (`worktreePath`, `worktreeBranch`,
  `worktreeStatus`, `baseRef`) and organization (`folder`, `tags`) — the
  worktree *lifecycle* itself belongs to the
  [Worktree Manager](worktree-manager.md).
- Provide the unified engineering timeline (`session:timeline` — activity +
  diagnostics + checkpoints) and the dependency summary shown before deletion.

## Storage

The `sessions` table holds id, workspace_id, title, branch, status, created_at,
updated_at, pinned, archived, deleted_at (soft delete), adds, dels, unread, mode,
worktree_path, worktree_branch, worktree_status, base_ref, folder, and tags.
See [the database](database.md).

## Public surface (key methods)

- `list(workspaceId)` (live; pinned first, then most recent), `listTrash(workspaceId)`
- `getActive()`, `setActive(id)`, `create(workspaceId, title?)`, `update(id, patch)`
  (patch now includes `folder` / `tags`)
- `duplicate(id)` (clones transcript + activity, new SDK session id; the IPC
  layer can additionally clone a fresh worktree via `cloneWorktree`)
- `softDelete(id)`, `restore(id)`, `purge(id)`
- `setWorktree(id, patch)` — the Worktree Manager stamps the worktree columns
- `setMode(id, mode)` (UI state; no `updated_at` bump)
- `bumpUnread(id)`, `applyGitStatus(workspaceId, {branch, adds, dels})` (skips
  worktree-backed sessions — their branch is their own), `autoTitle(sessionId, text)`

Reached via the `session:*` channels (including `session:createInWorktree`,
`session:getDependencies`, `session:timeline`).

## Dependencies and wiring

- The **Agent Manager** calls `autoTitle` from the first prompt and drives unread.
- The **File System Layer** calls `applyGitStatus` so session rows show live branch
  and diff counts (deduped, no `updated_at` bump).
- The **Worktree Manager** owns provisioning/removal and calls `setWorktree`;
  the session delete handler stops the session's supervised **services** and
  PTYs before trashing (worktree teardown is optional and dialog-driven).

## Data flow

Changes broadcast two events: `sessions:updated` (the list changed) and
`session:active-changed` (with the new active session). `useSessionStore` consumes
both and follows workspace switches.

## Security boundary

Renderer-supplied titles and ids are length-capped (`SESSION_LIMITS`). Soft delete
keeps a recovery window before `purge`.

## Planned

No standalone gaps; session features evolve with the agent and git subsystems.
