# Subsystem: File System Layer

## Purpose

The File System Layer is the centralized, guarded gateway for all workspace file
operations: watch, index, and read. Centralizing them means every read is bounds-
checked and every path is guarded, and the rest of the app gets a single, debounced
source of tree and change events. The watcher is single-instance, bound to the
active workspace only.

Source: [`src/main/managers/FileSystemManager.ts`](../../../src/main/managers/FileSystemManager.ts)
with `managers/fs/{ignore,tree,reader,watcher,history}.ts`.

## Responsibilities

- Build and cache the workspace directory tree (indexing).
- Watch the active workspace and debounce change bursts.
- Read workspace-relative files through a guarded, size-capped reader.
- Maintain a per-workspace file-access history.
- Push live git status into the session list.

## Submodules

- `fs/ignore.ts` — `buildIgnoreMatcher(root, config)` respects `.gitignore` and the
  workspace ignore rules (`DEFAULT_IGNORED_DIRS`).
- `fs/tree.ts` — `buildTree(...)` builds a paginated, truncation-aware tree.
- `fs/reader.ts` — `readWorkspaceFile(root, relPath)` does a guarded read with a size
  cap and encoding / binary detection.
- `fs/watcher.ts` — `WorkspaceWatcher` (chokidar) debounces changes.
- `fs/history.ts` — a bounded, most-recent-first access log.

## Public surface (key methods)

- `getTree(workspaceId)` (cached, no disk access), `index(workspaceId)` (coalesces
  concurrent passes, streams progress)
- `readFile(workspaceId, relPath)`, `getHistory(workspaceId)`,
  `reveal(workspaceId, relPath?)`
- `setActiveWorkspace(ws|null)`, `stopWatching()`, `dispose()`

Reached via the `fs:*` channels.

## Bounds

`FS_LIMITS` (in [`constants.ts`](../../../src/shared/constants.ts)) caps tree
entries, walk depth, single-read bytes (2 MiB), the binary-sniff window, progress
throttle, watch debounce, history length, and relative-path length.

## Dependencies and wiring

- `setSessionManager(sessions)` — on change bursts, push live git status (branch +
  diff counts) into session rows.
- `setGitManager(git)` — notify the Git Engine so its workspace refreshes live.

The active-workspace listener (in the main process) calls `setActiveWorkspace` so the
watcher follows workspace switches.

## Data flow

`fs:index-progress` (during an index pass) and `fs:tree-changed` (watcher or reindex)
are pushed to the renderer; `useFileSystemStore` consumes them.

## Security boundary

All reads go through the guarded reader (path validation, size cap, binary
detection); the watcher is single-instance and bounded in depth and entry count.
See [the security model](../security-model.md).

## Planned

A standalone Project Indexer / Search Engine (code index and search beyond the file
tree) is planned; see [ROADMAP.md](../../../ROADMAP.md).
