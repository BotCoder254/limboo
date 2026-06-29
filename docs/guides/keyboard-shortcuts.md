# Keyboard shortcuts

Limboo is driven by a command registry. Every command can be run from the command
palette, and the common ones have keyboard bindings. `Mod` is `Cmd` on macOS and
`Ctrl` elsewhere. The registry lives in
[`src/renderer/lib/commands.ts`](../../src/renderer/lib/commands.ts); the reference
list is [Commands](../reference/commands.md).

## The command palette

Press `Mod+K` to open the palette, then type to filter and run any command. Commands
run against the Zustand stores, so they work from anywhere in the UI.

## Default bindings

| Shortcut   | Command                    | Section   |
| ---------- | -------------------------- | --------- |
| `Mod+K`    | Open command palette       | General   |
| `Mod+O`    | Open folder as workspace   | Workspace |
| `Mod+N`    | New session                | Sessions  |
| `Mod+B`    | Toggle activity drawer     | View      |
| `` Mod+` `` | Toggle terminal           | View      |
| `Mod+,`    | Open settings              | General   |

## Other commands (palette)

These are available from the palette and the native menu / tray; not all have a
default binding:

- **Workspace** — Create workspace, Reindex workspace.
- **Sessions** — Duplicate session.
- **Agent** — New agent session, Stop the agent, Switch to Plan mode, Switch to
  Implement mode, Approve plan and execute.
- **View** — New terminal, Show Files / Changes / Tasks / Activity, Reload.

## Adding a command

Commands are added in `src/renderer/lib/commands.ts` (id, title, section, optional
keys, and a `run()` that operates on store `getState()`), then optionally wired to a
native menu / tray item that dispatches the command id. See
[Commands](../reference/commands.md) and
[the renderer architecture](../architecture/renderer-process.md).
