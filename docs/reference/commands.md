# Reference: commands

The command registry is the single list of user-invokable actions. It lives in
[`src/renderer/lib/commands.ts`](../../src/renderer/lib/commands.ts). Each command
has an `id`, a `title`, a `section`, optional `keys`, and a `run()` that operates on
Zustand store `getState()` so it works from anywhere. The command palette
(`Mod+K`), keyboard shortcuts, and the native menu / tray all dispatch the same
commands.

## Registry

| id | Title | Section | Keys |
| -- | ----- | ------- | ---- |
| `workspace.open` | Open folder as workspace | Workspace | `Mod+O` |
| `workspace.new` | Create workspace | Workspace | |
| `workspace.reindex` | Reindex workspace | Workspace | |
| `worktree.prune` | Prune stale worktrees | Workspace | |
| `session.new` | New session | Sessions | `Mod+N` |
| `session.newInWorktree` | New session in worktree | Sessions | `Mod+Shift+N` |
| `session.duplicate` | Duplicate session | Sessions | |
| `session.nextTab` | Next worktree tab | Sessions | `Ctrl+Tab` |
| `session.prevTab` | Previous worktree tab | Sessions | `Ctrl+Shift+Tab` |
| `agent.newSession` | New agent session | Agent | |
| `agent.stop` | Stop the agent | Agent | |
| `agent.planMode` | Switch to Plan mode | Agent | |
| `agent.implementMode` | Switch to Ask-before-edits mode | Agent | |
| `plan.approve` | Approve plan & execute | Agent | |
| `voice.toggle` | Toggle voice input | Agent | `Mod+Shift+M` |
| `sidebar.toggle` | Toggle activity drawer | View | `Mod+B` |
| `terminal.toggle` | Toggle terminal | View | `` Mod+` `` |
| `terminal.new` | New terminal | View | |
| `drawer.toggleFiles` | Show Files | View | |
| `drawer.toggleChanges` | Show Changes | View | |
| `drawer.toggleTasks` | Show Tasks | View | |
| `drawer.toggleActivity` | Show Activity | View | |
| `search.open` | Search everything | General | `Mod+P` |
| `settings.open` | Open settings | General | `Mod+,` |
| `view.reload` | Reload window | General | |
| `palette.open` | Open command palette | General | `Mod+K` |

`Mod` is `Cmd` on macOS and `Ctrl` elsewhere. A literal `Ctrl` in a combo means
the Control key on every platform (so `Ctrl+Tab` tab-cycling matches editor
muscle memory on macOS too). This table mirrors the registry; the source file
is authoritative.

## How dispatch works

- `useKeyboardShortcuts` binds the `keys` combos to command ids.
- `CommandPalette` (`Mod+K`) lists and runs commands.
- `useCommandBridge` runs commands dispatched from the native menu / tray via the
  `command:invoke` event.

## Adding a command

Add an entry to `COMMANDS` in `src/renderer/lib/commands.ts` (id, title, section,
optional keys, and a `run()` using store `getState()`), then optionally add a native
menu / tray item that calls `sendCommand(id)` in the main process. The `CommandId`
union in [`src/shared/types.ts`](../../src/shared/types.ts) keeps ids typed across
processes. See [keyboard shortcuts](../guides/keyboard-shortcuts.md).
