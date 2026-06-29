# IPC layer

The IPC layer is the seam between the sandboxed renderer and the privileged main
process. Because it is the only way capability crosses the boundary, it is also the
primary place input is validated. This page explains the contract, the wrapper that
enforces it, and how to add a channel.

## The naming contract

Channel names live in exactly one file,
[`src/shared/ipc-channels.ts`](../../src/shared/ipc-channels.ts), shared by both the
main-process handlers and the preload invokers so they can never drift. Convention:
`domain:action`. There are two kinds:

- `IpcChannels` — two-way request/response (`ipcRenderer.invoke` /
  `ipcMain.handle`).
- `IpcEvents` — one-way main -> renderer pushes (streaming events, live status).

The full list is in [the IPC channels reference](../reference/ipc-channels.md).

## The `handle()` wrapper and sender validation

Handlers are not registered with raw `ipcMain.handle`. They go through a `handle()`
wrapper in [`src/main/ipc/registry.ts`](../../src/main/ipc/registry.ts) that:

- **Validates the sender origin** before the handler runs. In development it allows
  the Vite dev-server origin; in production it allows `file://` only. Any message
  from an iframe, a hijacked navigation, or an injected frame is rejected.
- **Centralizes error handling** — a thrown error is logged with its channel name
  and re-thrown to the renderer as a rejected promise.

Every new handler goes through `handle()` and inherits this protection.

## Handler organization

Handlers are grouped by domain under `src/main/ipc/`, registered together by
`registerAllIpc()`:

```
registerWindowHandlers()      windowHandlers.ts
registerSettingsHandlers()    settingsHandlers.ts
registerSystemHandlers()      systemHandlers.ts
registerWorkspaceHandlers()   workspaceHandlers.ts
registerSessionHandlers()     sessionHandlers.ts
registerAgentHandlers()       agentHandlers.ts
registerFsHandlers()          fsHandlers.ts
registerTerminalHandlers()    terminalHandlers.ts
registerGitHandlers()         gitHandlers.ts
registerMemoryHandlers()      memoryHandlers.ts
```

Each handler is where renderer-supplied input is validated: lengths are capped (for
example commit messages, prompts, memory bodies), ids are required to be non-empty,
prototype-polluting keys (`__proto__` / `constructor` / `prototype`) are rejected
from any object that will be merged or used as a key, and structured errors (for
example workspace validation failures) are returned in a shape the UI can act on.

## The preload side

[`src/preload/index.ts`](../../src/preload/index.ts) maps each channel to a typed
method on `window.limboo`. It uses a small `subscribe()` helper for the `on*` event
methods, which return an unsubscribe function. The preload is the only bridge; it
exposes curated methods, never the raw `ipcRenderer`.

## Adding a channel (the full path)

A new OS-touching capability follows one path:

1. Add the name to `IpcChannels` (or `IpcEvents`) in `src/shared/ipc-channels.ts`.
2. Add a handler in the appropriate `src/main/ipc/*Handlers.ts`, through `handle()`,
   validating every input.
3. Add a typed method in `src/preload/index.ts`.
4. Call it from the renderer (usually from a Zustand store).

Do not reach for Node APIs in the renderer; that is what this path exists to avoid.
See [contributing](../contributing/development-workflow.md) and
[the security model](security-model.md).
