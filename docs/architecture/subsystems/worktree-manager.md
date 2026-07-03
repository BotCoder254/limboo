# Subsystem: Worktree Manager

## Purpose

The Worktree Manager gives sessions first-class git worktrees: an isolated
checkout directory plus its own branch, so multiple sessions (and their agents,
terminals, and services) proceed in parallel without contending for one working
tree. It owns the worktree lifecycle and is the **single resolver of a
session's effective execution root** — every other manager asks it instead of
deriving paths itself. See the [Git workflow guide](../../guides/git-workflow.md).

Source: [`src/main/managers/worktree/WorktreeManager.ts`](../../../src/main/managers/worktree/WorktreeManager.ts)
(+ [`paths.ts`](../../../src/main/managers/worktree/paths.ts) containment guards,
[`config.ts`](../../../src/main/managers/worktree/config.ts) `limboo.json` parsing).

## Responsibilities

- Provision a worktree per session: `{root}/{sha1(repo)[:12]}/{slug}` under a
  configurable root (default `{userData}/worktrees`), branch `{prefix}/{slug}`
  via argv-only `git worktree add -b`. Creation rolls the session back to a
  plain session on failure.
- Resolve the effective root: `resolveSessionRoot(sessionId)` /
  `resolveActiveRoot(workspaceId)` return the worktree when the session owns a
  healthy one, else the workspace path — injected into the Agent, Terminal,
  Git, Search, and File System managers.
- Windows-safe removal ordering: stop services → run acked teardown hooks →
  dispose the session's PTYs → release the file watcher off the directory →
  `git worktree remove` (busy-retry) → guarded `fs.rm` fallback → optional
  branch delete → clear the session's worktree columns.
- Recovery: boot-time `recover()` flags vanished checkouts as `missing` (the
  UI offers **Recreate** — from the surviving branch or base ref — or
  **Detach**) and runs `git worktree repair` + `prune` per repository. A failed
  recreate restores the recorded branch/base metadata so it stays retryable.
- Trust gate for `limboo.json` (see the [reference](../../reference/limboo-json.md)):
  `ackConfig` persists a per-workspace hash acknowledgment of the exact
  displayed commands; `runSetup` acks then streams setup hooks through visible
  terminals; teardown runs only while the ack still matches the current hash.
- Archive lifecycle: archiving with `teardownOnArchive` reclaims the directory
  but keeps branch + base ref; unarchiving recreates the environment.
- Dependency summary for the delete dialog (`getDependencies`): worktree
  existence/dirtiness, branch existence, live terminals, checkpoints, memory
  links, plan.

## Public surface (key methods)

- `createForSession(sessionId, {baseRef?, branch?})`, `removeForSession(sessionId,
  {force?, deleteBranch?, preserveBranchMeta?})`
- `resolveSessionRoot(sessionId)`, `resolveActiveRoot(workspaceId)`
- `list(workspaceId)`, `prune(workspaceId)`, `recover()`
- `recreateForSession(sessionId)`, `detachForSession(sessionId)`
- `getRepoConfigState(sessionId)`, `ackConfig(sessionId, ackHash)`,
  `runSetup(sessionId, ackHash)`
- `getDependencies(sessionId)`, `onSessionArchivedChanged(sessionId, archived)`

Reached via the `worktree:*` channels (and `session:createInWorktree` /
`session:getDependencies` on the session side).

## Dependencies and wiring

Constructed with the Workspace, Session, and Settings managers; the Terminal
and Service managers are attached after construction (narrow interfaces). The
composition root registers a release-root hook so the watcher/search index are
retargeted off a directory before it is removed, and calls the resolvers on
every active-workspace/active-session change (`retargetEffectiveRoot`).

## Data flow

Lifecycle changes broadcast `worktrees:updated` (reserved — no renderer
consumer yet) **and** `sessions:updated`; session rows carry the
`worktreePath/worktreeBranch/worktreeStatus/baseRef` fields the tabs, delete
dialog, and missing-worktree banner render from. Hook/setup steps also write
`agent_diagnostics` rows (category `worktree`) into the session timeline.

## Security boundary

All git runs go through argv-only `runGit` (no shell) with bounded timeouts
(`WORKTREE_LIMITS`); branch/base refs pass `sanitizeRef`; slugs are generated
main-side only; every created/removed path passes `assertInsideWorktreeRoot`
(realpath-aware) before the filesystem is touched, so the recursive-delete
fallback can never run outside the worktree root. Repo-authored commands never
execute before the workspace acknowledges the exact config hash. See
[the security model](../security-model.md).
