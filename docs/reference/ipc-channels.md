# Reference: IPC channels

Channel names live in exactly one place,
[`src/shared/ipc-channels.ts`](../../src/shared/ipc-channels.ts), so the
main-process handlers and the preload invokers can never drift. The convention is
`domain:action`. Two-way request/response uses `invoke` / `handle`; one-way
main -> renderer pushes are the `Events` channels.

This page mirrors that file. When in doubt, the source file is authoritative.

## `IpcChannels` (invoke / handle)

| Domain    | Channels |
| --------- | -------- |
| Window    | `window:minimize`, `window:maximize`, `window:close`, `window:isMaximized` |
| Settings  | `settings:getAll`, `settings:get`, `settings:set`, `settings:reset` |
| System    | `system:notify`, `system:openExternal`, `system:clipboard:write`, `system:clipboard:read` |
| App       | `app:getInfo` |
| Workspace | `workspace:list`, `workspace:get`, `workspace:pickDirectory`, `workspace:create`, `workspace:open`, `workspace:switch`, `workspace:remove`, `workspace:toggleFavorite`, `workspace:updateConfig`, `workspace:getStats`, `workspace:rescan` |
| Session   | `session:list`, `session:create`, `session:update`, `session:duplicate`, `session:delete`, `session:restore`, `session:purge`, `session:setActive`, `session:getActive` |
| Agent     | `agent:getInstall`, `agent:getState`, `agent:send`, `agent:stop`, `agent:getSnapshot`, `agent:permissionRespond`, `agent:clearSession`, `agent:getDiagnostics`, `agent:clearRateLimit`, `agent:retryAuth` |
| Plan mode | `agent:getPlan`, `agent:approvePlan`, `agent:rejectPlan`, `agent:regeneratePlan` |
| File system | `fs:index`, `fs:getTree`, `fs:readFile`, `fs:getHistory`, `fs:reveal` |
| Terminal  | `terminal:create`, `terminal:list`, `terminal:write`, `terminal:resize`, `terminal:kill`, `terminal:rename`, `terminal:clear` |
| Git       | `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:stageAll`, `git:unstageAll`, `git:discard`, `git:commit`, `git:log`, `git:commitDetail`, `git:branches`, `git:checkout`, `git:createBranch`, `git:tags`, `git:createTag`, `git:blame`, `git:fetch`, `git:push`, `git:pull`, `git:init`, `git:checkpointCreate`, `git:checkpointList`, `git:checkpointDiff`, `git:checkpointRestore`, `git:checkpointDelete` |
| Memory    | `memory:list`, `memory:get`, `memory:search`, `memory:create`, `memory:update`, `memory:delete`, `memory:archive`, `memory:pin`, `memory:listProposals`, `memory:acceptProposal`, `memory:rejectProposal` |

## `IpcEvents` (one-way main -> renderer)

| Channel | Meaning |
| ------- | ------- |
| `window:maximized-changed` | The window maximized state changed. |
| `settings:changed` | Settings changed (rebroadcast to all windows). |
| `command:invoke` | A native menu / tray item asks the renderer to run a command id. |
| `workspace:changed` | The active workspace changed. |
| `workspaces:updated` | The set of registered workspaces changed. |
| `sessions:updated` | The set of sessions changed. |
| `session:active-changed` | The active session changed. |
| `agent:state-changed` | Agent runtime state changed (status / install / request). |
| `agent:event` | A structured agent event (message delta, tool call, file change, ...). |
| `agent:permission-request` | The agent needs the user to approve or deny a tool. |
| `fs:index-progress` | Progress of an in-flight workspace index pass. |
| `fs:tree-changed` | The active workspace's directory tree changed. |
| `terminal:data` | A chunk of PTY output (raw VT bytes). |
| `terminal:exit` | A terminal's PTY exited. |
| `terminal:updated` | The set of terminals for a workspace changed. |
| `terminal:command` | An agent-run shell command mirrored into the terminal. |
| `git:changed` | The active workspace's git state changed. |
| `git:checkpoints-changed` | A session's checkpoints changed. |
| `memory:changed` | The memory store changed. |

## Adding a channel

1. Add the name to `IpcChannels` or `IpcEvents` in `src/shared/ipc-channels.ts`.
2. Register a handler in the appropriate `src/main/ipc/*Handlers.ts`, through the
   `handle()` wrapper (which enforces sender validation).
3. Add a typed method in `src/preload/index.ts`.
4. Call it from the renderer (typically from a Zustand store).

See [the IPC layer architecture](../architecture/ipc-layer.md).
