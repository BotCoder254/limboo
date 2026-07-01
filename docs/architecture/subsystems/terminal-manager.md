# Subsystem: Terminal Manager

## Purpose

The Terminal Manager provides real, workspace-scoped shells backed by pseudo-
terminals. It exists so the agent and the user share one terminal surface inside the
workspace, with output streamed to the renderer and bounded so a burst cannot exhaust
memory. See the [Terminal guide](../../guides/terminal.md).

Source: [`src/main/managers/TerminalManager.ts`](../../../src/main/managers/TerminalManager.ts).

## Responsibilities

- Spawn, list, write to, resize, rename, clear, and kill PTYs per workspace.
- Stream PTY output and exit to the renderer; mirror agent shell commands.
- Bound scrollback and concurrency.

## Public surface (key methods)

- `list(workspaceId)`, `create(workspaceId, {cols?, rows?, title?, origin?})`
- `write(terminalId, data)`, `resize(terminalId, cols, rows)`, `rename`, `clear`,
  `kill`
- `disposeWorkspace(workspaceId)`, `dispose()`
- `ensureAgentTerminal(workspaceId)`, `mirrorAgentCommand(record)`

Reached via the `terminal:*` channels.

## Spawn details

PTYs are spawned via `pty.spawn(shell, shellArgs, { cwd, cols, rows, env })`, where
`pty` is `node-pty` pinned to the `1.2.0-beta` line — Microsoft's Node-API rewrite
of the addon, whose bundled per-platform prebuilt is ABI-stable across Node.js and
Electron and never needs a `node-gyp` rebuild (see
[installation](../../getting-started/installation.md)).
The shell is resolved from the workspace config, then the global terminal setting,
then the OS default. Args add interactive flags for bash / zsh / sh. The environment
is sanitized: it inherits the user PATH and adds `TERM=xterm-256color`,
`LIMBOO_TERMINAL=1`, and `GIT_TERMINAL_PROMPT=0` (so git never blocks on a credential
prompt). Each terminal records its `origin` (`user` or `agent`).

## Bounds

`TERMINAL_LIMITS` (in [`constants.ts`](../../../src/shared/constants.ts)) caps
concurrent terminals per workspace, the scrollback ring, single-write bytes, the
title length, and the PTY grid.

## Dependencies and wiring

The **Agent Manager** uses `ensureAgentTerminal` and `mirrorAgentCommand` to surface
the commands it runs in the integrated terminal (controlled by the
`agent.terminal.mirrorAgentCommands` setting). Mirrored commands are records of what
the agent ran, surfaced for visibility.

## Data flow

`terminal:data` (output chunks), `terminal:exit`, `terminal:updated`, and
`terminal:command` are pushed to the renderer; `useTerminalStore` consumes them and
keeps scrollback for replay on rehydrate.

## Security boundary

argv-style spawn (no `shell: true`), `cwd` pinned to the workspace root and validated
to stay inside (symlink-aware), output not logged, scrollback bounded, writes
byte-capped, and concurrency limited. See [the security model](../security-model.md).
