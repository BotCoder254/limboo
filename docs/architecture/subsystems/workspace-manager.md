# Subsystem: Workspace Manager

## Purpose

A workspace is the bounded project root every other subsystem operates against. The
Workspace Manager owns the lifecycle of workspaces and is the single source of truth
for the workspace list and the active workspace. Bounding everything to a workspace
is also the security primitive that path guards enforce.

Source: [`src/main/managers/WorkspaceManager.ts`](../../../src/main/managers/WorkspaceManager.ts)
(plus `managers/workspace/{validate,detect,icon,stats}.ts`).

## Responsibilities

- Register, open, switch, and remove workspaces.
- Validate paths and detect the tech stack.
- Track the active workspace and notify in-process listeners.
- Compute workspace statistics and per-workspace config.

## Public surface (key methods)

- `list()`, `getActive()`, `getById(id)`, `getStats(id)`
- `create(path)`, `open(path)`, `switch(id)`, `remove(id, deleteFiles=false)`
- `toggleFavorite(id)`, `updateConfig(id, patch)`, `rescan(id)`
- `onActiveChanged(cb)` — in-process listeners (not an IPC broadcast).

Reached from the renderer via the `workspace:*` channels; see
[the IPC channels reference](../../reference/ipc-channels.md).

## Validation and detection

- `validateWorkspacePath()` — the path exists, is an accessible directory, is not a
  duplicate, and is not a forbidden root. System roots and the user's home directory
  are rejected (`FORBIDDEN_WORKSPACE_PATHS` in
  [`constants.ts`](../../../src/shared/constants.ts)). Symlink-aware via
  `realpath`.
- `detectWorkspace(path)` — probes for git, Node.js, Python, Docker, and lockfiles to
  derive metadata; `deriveIcon` picks a project icon; `computeStats` counts files /
  directories.

## Dependencies and wiring

The active-workspace listener is the hub of the app's per-workspace wiring. When the
active workspace changes (`onActiveChanged`):

- the **File System Layer** tears down the old watcher and watches / indexes the new
  root, and seeds the session list's git status;
- the **Memory System** seeds starter memories for the workspace (idempotent).

See [the main process](../main-process.md).

## Data flow

`workspace:changed` and `workspaces:updated` are pushed to the renderer so
`useWorkspaceStore` stays current. `remove` never deletes files — it only unregisters
the workspace.

## Security boundary

Path validation here is the first line of the path-traversal defense; every later
file / git / terminal operation is additionally guarded against the workspace root.
`updateConfig` rejects prototype-polluting keys. See
[the security model](../security-model.md).

## Planned

A repository clone / track UI (clone a remote and register it as a workspace from
inside the app) is planned; see [ROADMAP.md](../../../ROADMAP.md).
