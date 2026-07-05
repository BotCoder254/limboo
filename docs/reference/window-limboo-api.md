# Reference: the `window.limboo` API

`window.limboo` is the typed bridge the preload exposes to the renderer through
`contextBridge`. It is the only way the UI reaches the main process. The source of
truth is [`src/preload/index.ts`](../../src/preload/index.ts) (`LimbooApi`), with
types flowing into the renderer via [`src/global.d.ts`](../../src/global.d.ts).

Every method maps to a channel name in
[`src/shared/ipc-channels.ts`](../../src/shared/ipc-channels.ts); see the
[IPC channels reference](ipc-channels.md). Subscriptions (the `on*` methods) return
an unsubscribe function.

The API has 18 namespaces:

```
window.limboo.{ window, settings, system, app, events,
               workspace, session, agent, fs, terminal, git,
               worktree, services, memory, search, updates, voice,
               attachment }
```

## window

Frameless window controls.

- `minimize()`, `maximize() -> boolean`, `close()`, `isMaximized() -> boolean`
- `onMaximizedChange(cb)` — subscription.

## settings

Persistent user preferences (see [Settings](settings.md)).

- `getAll() -> AppSettings`
- `set(patch: DeepPartial<AppSettings>) -> AppSettings`
- `reset() -> AppSettings`
- `onChange(cb)` — subscription.

## system

Native OS integrations.

- `notify({ title, body?, silent? })`
- `openExternal(url)`, `clipboardWrite(text)`, `clipboardRead() -> string`
- `getDroppedPath(file: File) -> string` — resolves a dropped/selected file's
  absolute path via `webUtils.getPathForFile`; the path is then handed to the
  validated `workspace:open` IPC.

## app

- `getInfo() -> AppInfo` — version / electron / platform metadata.

## events

- `onCommand(cb)` — a native menu / tray / shortcut asking the renderer to run a
  command by id. Subscription.

## workspace

- `list()`, `getActive()`, `pickDirectory()`
- `create(path)`, `open(path)`, `switch(id)`, `remove(id, deleteFiles?)`
- `toggleFavorite(id)`, `updateConfig(id, patch)`, `getStats(id)`, `rescan(id)`
- `onChanged(cb)`, `onUpdated(cb)` — subscriptions.

## session

- `list(workspaceId, trash?)`, `getActive()`
- `create(workspaceId, title?)`, `update(id, patch)`,
  `duplicate(id, { cloneWorktree? }?)`
- `delete(id, SessionDeleteOptions?)` — options: `removeWorktree`,
  `deleteBranch`, `force`
- `restore(id)`, `purge(id)`, `setActive(id)`
- `createInWorktree(workspaceId, { title?, baseRef?, branch? }?)` — a session
  that owns a dedicated git worktree (isolated checkout + branch)
- `getDependencies(id) -> SessionDependencies` — what the session owns
  (worktree, branch, terminals, checkpoints, memory links, plan), shown before
  deletion
- `timeline(id, limit?) -> SessionTimelineEntry[]` — unified engineering
  timeline (activity + diagnostics + checkpoints)
- `onUpdated(cb)`, `onActiveChanged(cb)` — subscriptions.

## agent

Coding-agent orchestration and the structured event stream.

- `getInstall()`, `getState()`, `getSnapshot(sessionId)`
- `send(sessionId, prompt, mode?, clientMessageId?)`, `stop(sessionId)`
- `getPlan(sessionId)`, `approvePlan(sessionId)`, `rejectPlan(sessionId)`,
  `regeneratePlan(sessionId, extra?)`
- `clearSession(sessionId)`, `getDiagnostics(sessionId?)`, `clearRateLimit()`,
  `retryAuth()`, `respondPermission(decision)`
- `onStateChanged(cb)`, `onEvent(cb)`, `onPermissionRequest(cb)` — subscriptions.
  `onEvent` is the unified streaming timeline; see [Data flow](../architecture/data-flow.md).

## fs

File System Layer: read, write, watch, index.

- `index(workspaceId)`, `getTree(workspaceId)`, `readFile(workspaceId, relPath)`
- `getHistory(workspaceId)`, `reveal(workspaceId, relPath?)`
- `writeFile(workspaceId, relPath, content, opts?)`, `createFile(workspaceId, relPath)`,
  `createDir(workspaceId, relPath)` — guarded File Writer mutations (atomic writes,
  workspace-boundary + symlink + `.git` protection in main)
- `remove(workspaceId, relPath, opts?)` (non-empty dirs need `{ recursive: true }`),
  `rename(workspaceId, fromRel, toRel, opts?)` (rename AND move),
  `copy(workspaceId, fromRel, toRel, opts?)`
- `onIndexProgress(cb)`, `onTreeChanged(cb)` — subscriptions (mutations surface
  through `onTreeChanged`; no dedicated mutation events).

## terminal

Workspace-scoped PTY sessions.

- `create(workspaceId, opts?)`,
  `list(workspaceId) -> { terminals, scrollback }`
- `write(terminalId, data)`, `resize(terminalId, cols, rows)`,
  `kill(terminalId)`, `rename(terminalId, title)`, `clear(terminalId)`
- `onData(cb)`, `onExit(cb)`, `onUpdated(cb)`, `onCommand(cb)` — subscriptions.

## git

Deep git integration (all workspace-scoped).

- Read: `status`, `diff`, `log`, `commitDetail`, `branches`, `tags`, `blame`.
- Working tree: `stage`, `unstage`, `stageAll`, `unstageAll`, `discard`, `commit`.
- Branch / tag: `checkout`, `createBranch`, `createTag`.
- Network: `fetch`, `push(opts?)`, `pull(opts?)`, `init`.
- Checkpoints: `checkpointCreate`, `checkpointList`, `checkpointDiff`,
  `checkpointRestore`, `checkpointDelete`.
- `onChanged(cb)`, `onCheckpointsChanged(cb)` — subscriptions.

## worktree

Session-owned git worktrees (see
[the Worktree Manager](../architecture/subsystems/worktree-manager.md)).

- `list(workspaceId) -> WorktreeInfo[]` — repo worktrees joined to owning
  sessions (reserved for a future worktree panel; no UI consumer yet)
- `prune(workspaceId)` — drop stale worktree metadata
- `recreate(sessionId)`, `detach(sessionId)` — missing-worktree recovery
- `getRepoConfig(sessionId) -> RepoConfigState` — the repo's
  [limboo.json](limboo-json.md) + hash + acknowledgment state
- `ackConfig(sessionId, ackHash)` — trust the displayed config (works without
  setup hooks and for plain sessions)
- `runSetup(sessionId, ackHash)` — acknowledge + run setup hooks
- `onUpdated(cb)` — subscription (reserved; session rows already refresh via
  `session.onUpdated`).

## services

Scripts & Services from [limboo.json](limboo-json.md) (see
[the Service Manager](../architecture/subsystems/service-manager.md)).

- `list(sessionId) -> ServiceInfo[]`
- `start(sessionId, name)`, `stop(sessionId, name)`, `restart(sessionId, name)`
- `runScript(sessionId, name)` — on-demand script in a visible terminal
- `onUpdated(cb)` — subscription (`{ sessionId, services }` pushes).

## memory

Local Memory System.

- `list(filter)`, `get(id)`, `search(query, opts)`
- `create(input)`, `update(id, patch)`, `remove(id)`
- `archive(id, archived)`, `pin(id, pinned)`
- `listProposals(workspaceId)`, `acceptProposal(id)`, `rejectProposal(id)`
- `onChanged(cb)` — subscription.

## search

Search Engine (global retrieval + index management): `global`, `files`,
`symbols`, `reindex`, `getStatus`, history/saved-search CRUD, and
`onChanged` / `onIndexProgress` subscriptions.

## updates

Auto-update lifecycle (packaged builds): `getState`, `check`, `download`,
`install`, and the `onStatus` subscription.

## voice

Local voice subsystem: runtime controls (`getState`, `start`, `stop`,
`cancel`, `speak`, `stopSpeaking`), model management (`models.*`), and the
`voice:*` event subscriptions. Mic audio streams main-ward over the
fire-and-forget `voice:audio-chunk` send channel.

## attachment

Attachment Manager — session-owned files staged for the agent's tool loop.

- `list(sessionId)` — all attachments (drafts + sent), oldest first.
- `pickFiles(sessionId)` — native multi-file picker → stage.
- `addPaths(sessionId, paths)` — stage dropped files (paths from `getPathForFile`).
- `addPasted(sessionId, name, mime, bytes)` — stage a pasted image.
- `remove(sessionId, id)`, `reveal(sessionId, id)`
- `getPathForFile(file)` — resolve a dropped `File`'s real path (webUtils).
- `onChanged(cb)` / `onProgress(cb)` — subscriptions (set changes / staging %).

## Usage note

Renderer calls guard with optional chaining (`window.limboo?.…`) so the UI still
renders in a plain browser preview where the preload is absent. Adding a method here
requires the full bridge path; see [the IPC layer](../architecture/ipc-layer.md).
