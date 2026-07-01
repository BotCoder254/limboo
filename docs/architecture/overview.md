# Architecture overview

This is the entry point for the architecture documentation. It gives the system map
and the principles that constrain every design decision. From here, drill into the
[process model](process-model.md), the [IPC layer](ipc-layer.md), the
[main](main-process.md) and [renderer](renderer-process.md) processes,
[data flow](data-flow.md), the [security model](security-model.md),
[repository structure](repository-structure.md), and the per-subsystem pages under
[subsystems](subsystems/agent-manager.md).

The deepest, code-level contract is [`CLAUDE.md`](../../CLAUDE.md); the product
vision is [`project.md`](../../project.md). These pages explain why the system is
shaped the way it is.

## What Limboo is, architecturally

Limboo is the environment around a coding agent. The agent reasons and writes code;
Limboo owns everything else — workspaces, sessions, the filesystem, git, terminals,
the database, durable memory, and a strict security boundary. This separation is the
core architectural bet: by not being the model, Limboo can be a clean, modular,
local-first platform.

## The three-context model

Limboo runs three Electron contexts with a hard boundary between them:

```
 Renderer (Chromium + React)   src/renderer/**   UI only — it asks, never performs
        |  window.limboo.*
        v
 Preload (contextBridge)        src/preload/index.ts   the only bridge
        |  ipcRenderer <-> ipcMain
        v
 Main (Node.js + OS access)     src/main/**   workspaces, git, terminal, fs, agent,
                                              memory, SQLite — all OS-touching work
```

- The **renderer** holds no business logic; state lives in Zustand stores and data
  crosses via the preload bridge.
- The **preload** is the single `contextBridge` surface (`window.limboo`).
- The **main** process owns all filesystem, git, shell, database, and agent work.

`contextIsolation` is on, `nodeIntegration` is off, and the window runs with
`sandbox: true`. See [process model](process-model.md) and
[security model](security-model.md).

## Manager-per-responsibility

The main process is organized as managers, each owning exactly one responsibility,
which avoids tightly coupled code:

```
 Electron Main Process
   |
   |-- Settings / Notification / AppMenu / Tray   (desktop chrome + prefs)
   |-- Workspace Manager                          (project lifecycle)
   |-- Session Manager                            (units of work)
   |-- Git Engine (+ git/{exec,parse,status})     (deep git + checkpoints)
   |-- Terminal Manager                           (PTY shells, node-pty fork)
   |-- File System Layer (+ fs/{...})             (watch + index + read)
   |-- Agent Manager (+ memory MCP tools)         (agent orchestration)
   |-- Memory Manager                             (Local Memory System)
   |-- Local Database                             (SQLite, owned by main)
```

Managers are wired together in [`src/main/index.ts`](../../src/main/index.ts). See
[the main process](main-process.md) and the
[subsystem pages](subsystems/workspace-manager.md).

## Shared contracts

Code shared across all processes lives in `src/shared/`:

- [`ipc-channels.ts`](../../src/shared/ipc-channels.ts) — channel names (the
  contract that prevents drift).
- [`types.ts`](../../src/shared/types.ts) — domain models (`Session`, `Workspace`,
  `AgentEvent`, `Memory`, and more).
- [`constants.ts`](../../src/shared/constants.ts) — defaults and the limits both
  processes clamp against.

## Guiding principles

Every decision serves: Fast, Local, Private, Modular, Secure, Responsive,
Observable, Predictable, Recoverable ([`project.md`](../../project.md) §4). Concretely
that means: the renderer never performs OS work; there is no backend, no telemetry,
no stored credentials; the theme is dark-only; and the security hardening in
[the security model](security-model.md) is never weakened.

## Reading order for a new contributor

1. This page, then [process model](process-model.md).
2. [IPC layer](ipc-layer.md) — how capability crosses the boundary.
3. [Main process](main-process.md) and [renderer process](renderer-process.md).
4. [Data flow](data-flow.md) — the streaming timeline end to end.
5. The [subsystem](subsystems/agent-manager.md) relevant to your change.
6. [Security model](security-model.md) before you touch the main process.
