# Process model

Limboo is an Electron application, and Electron's process model is the most important
thing to understand before working in the codebase. Contributors unfamiliar with
Electron often confuse the responsibilities of the main process, the renderer, and
the preload script. This page makes the separation explicit and explains why it is
drawn where it is.

## The three contexts

```
 Renderer (Chromium + React)   src/renderer/**   (entry: main.tsx)
        |  window.limboo.*
        v
 Preload (contextBridge)        src/preload/index.ts   (the ONLY bridge)
        |  ipcRenderer <-> ipcMain
        v
 Main (Node.js + OS access)     src/main/**   (entry: index.ts)
```

### Renderer — UI only

The renderer is a Chromium page running React. It draws the interface and holds view
state in Zustand stores. It has **no** `fs`, no `child_process`, no git, no terminal
logic, and no direct Node APIs. It asks the main process to do things; it never does
them itself. This is enforced by the sandbox, not merely by convention.

### Main — the OS owner

The main process is Node.js with full OS access. All filesystem, git, shell, SQLite,
indexing, agent orchestration, and background work lives here (or in worker /
utility processes spawned from here). Native OS functionality belongs in main
because:

- it requires Node / native modules the sandboxed renderer cannot have,
- it must be validated centrally before touching the OS, and
- it must outlive any single renderer view and survive restarts (persisted state).

Examples that belong in main: filesystem access and watching, terminal
orchestration, process management, native dialogs, notifications, application
lifecycle, and workspace / session / settings persistence.

### Preload — the only bridge

The preload script runs with `contextIsolation` on and `nodeIntegration` off. It
uses `contextBridge` to expose a tightly scoped, typed API on `window.limboo` — not
unrestricted Node access. Exposing a curated bridge (rather than the `ipcRenderer`
object or Node built-ins) is what keeps a compromised renderer from reaching the OS.
The bridge surface is documented in
[the `window.limboo` reference](../reference/window-limboo-api.md).

## Why everything crosses IPC

Because the renderer cannot touch the OS, every capability is a message: the renderer
invokes a channel, a main-process handler validates and performs the work, and the
result returns. One-way pushes (streaming events, live status) flow the other way as
events. Channel names are centralized so the two sides cannot drift. See
[the IPC layer](ipc-layer.md).

## Security posture of the model

The model is hardened by default and must stay that way:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- A single preload bridge; no raw `ipcRenderer` or Node built-ins exposed.
- IPC sender-origin validation on every handler.
- Navigation and `<webview>` lockdown; external links open in the OS browser.
- Deny-by-default web-platform permissions.

These are detailed in [the security model](security-model.md) and must never be
weakened.

## How state survives restarts

Persistent state lives in the main process and on disk: settings
(`settings.json`), window geometry (`window-state.json`), and the SQLite database
(`limboo.db`) holding workspaces, sessions, transcripts, memories, and checkpoints.
On boot, the renderer hydrates from main through the bridge. See
[the main process](main-process.md) and [the database](subsystems/database.md).
