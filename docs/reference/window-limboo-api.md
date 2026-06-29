# Reference: the `window.limboo` API

`window.limboo` is the typed bridge the preload exposes to the renderer through
`contextBridge`. It is the only way the UI reaches the main process. The source of
truth is [`src/preload/index.ts`](../../src/preload/index.ts) (`LimbooApi`), with
types flowing into the renderer via [`src/global.d.ts`](../../src/global.d.ts).

Every method maps to a channel name in
[`src/shared/ipc-channels.ts`](../../src/shared/ipc-channels.ts); see the
[IPC channels reference](ipc-channels.md). Subscriptions (the `on*` methods) return
an unsubscribe function.

The API has 12 namespaces:

```
window.limboo.{ window, settings, system, app, events,
               workspace, session, agent, fs, terminal, git, memory }
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
- `create(workspaceId, title?)`, `update(id, patch)`, `duplicate(id)`
- `delete(id)`, `restore(id)`, `purge(id)`, `setActive(id)`
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

File System Layer: read, watch, index.

- `index(workspaceId)`, `getTree(workspaceId)`, `readFile(workspaceId, relPath)`
- `getHistory(workspaceId)`, `reveal(workspaceId, relPath?)`
- `onIndexProgress(cb)`, `onTreeChanged(cb)` — subscriptions.

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

## memory

Local Memory System.

- `list(filter)`, `get(id)`, `search(query, opts)`
- `create(input)`, `update(id, patch)`, `remove(id)`
- `archive(id, archived)`, `pin(id, pinned)`
- `listProposals(workspaceId)`, `acceptProposal(id)`, `rejectProposal(id)`
- `onChanged(cb)` — subscription.

## Usage note

Renderer calls guard with optional chaining (`window.limboo?.…`) so the UI still
renders in a plain browser preview where the preload is absent. Adding a method here
requires the full bridge path; see [the IPC layer](../architecture/ipc-layer.md).
