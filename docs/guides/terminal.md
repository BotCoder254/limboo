# Terminal

Limboo includes an integrated terminal backed by real pseudo-terminals. This guide
covers using it; the internals are in the
[Terminal Manager architecture](../architecture/subsystems/terminal-manager.md).

## What it is

The Terminal tab in the activity drawer hosts workspace-scoped shells. Each terminal
is a `node-pty` pseudo-terminal spawned in the main process, with its output streamed
to the renderer and rendered by xterm. Scrollback is buffered so a terminal can be
restored on reload.

## Creating and managing terminals

- **Create** a terminal for the active workspace (command palette: "New terminal").
- **Rename**, **clear**, and **kill** terminals.
- There is a cap on concurrent terminals per workspace to prevent runaway spawning.

The shell is resolved from your workspace config, then the global terminal setting,
then the OS default. Terminals spawn in the workspace root.

## Agent command mirroring

When the agent runs a shell command, Limboo can mirror it into the integrated
terminal as a command record, so the agent's shell activity and your own share one
view. This is controlled by the `agent.terminal.mirrorAgentCommands` setting.

Note that mirrored agent commands are records of what the agent ran, surfaced for
visibility; the agent's execution and your interactive shells are distinct.

## Safety

The terminal is spawned argv-style (no `shell: true` string interpolation), pinned to
the workspace root with a symlink-aware containment check, with `GIT_TERMINAL_PROMPT`
disabled so git never blocks on a credential prompt. Output is bounded by a
scrollback ring so a burst cannot exhaust memory, and writes are byte-capped. See
[the security model](../architecture/security-model.md).

## See also

- [Configuration](../getting-started/configuration.md) — terminal settings.
- [Terminal Manager architecture](../architecture/subsystems/terminal-manager.md).
