# Renderer process

The renderer is presentation only. It draws the pure-black three-pane shell, holds
view state in Zustand slice stores, and reaches the main process exclusively through
the `window.limboo` bridge. This page maps the renderer so you can find where things
live. The entry is [`src/renderer/main.tsx`](../../src/renderer/main.tsx).

## Startup and hydration

`main.tsx` mounts an error boundary and a loading-screen hydration gate, then calls
`useSettingsStore.hydrate()` before rendering `App`. `App.tsx` composes the shell and
hydrates the rest of the stores in order, subscribing each to its live event stream:

```
settings  ->  workspace  ->  session  ->  agent  ->  fs / terminal / git / memory
```

The agent store subscribes to `agent:event` (the streaming timeline),
`agent:state-changed`, and `agent:permission-request`. `App` gates the shell on an
active workspace, showing a workspace launcher until one is picked.

## The shell

[`app/AppShell.tsx`](../../src/renderer/app/AppShell.tsx) is the resizable layout: a
frameless title bar over a horizontal row of regions — a sessions sidebar (or
collapsed rail), the center workspace, and a right activity drawer plus a fixed icon
rail. Region widths live in the layout store and persist (debounced) to settings.
Resizing uses the hand-rolled `useResizable` hook. See
[conversation-first UI](../concepts/conversation-first-ui.md).

The center column ([`features/workspace/CenterWorkspace.tsx`](../../src/renderer/features/workspace/CenterWorkspace.tsx))
is a session header, the scrollable `ConversationView`, and a docked `Composer`.

## Zustand slice stores

State is split into slice stores under `src/renderer/stores/`:

| Store | Responsibility |
| ----- | -------------- |
| `useSettingsStore` | mirrors the main `SettingsManager`; hydrates, applies appearance side effects, write-through |
| `useLayoutStore` | live sidebar widths, active tab, collapsed state; persisted debounced |
| `useWorkspaceStore` | registered workspaces and the active one |
| `useSessionStore` | sessions for the active workspace, selection, filters |
| `useAgentStore` | agent lifecycle, per-session snapshots, diagnostics, permissions; applies the event stream |
| `useFileSystemStore` | per-workspace trees and index progress |
| `useTerminalStore` | terminals, scrollback, data/exit, mirrored commands |
| `useGitStore` | status, log, branches, tags, checkpoints, diff cache |
| `useMemoryStore` | memories, proposals, search |
| `useUIStore` | toasts, modals, command-palette open state |

All stores follow the same hydration pattern: bail if already hydrated, fetch
initial data through the bridge, subscribe to live events, mark hydrated.

## Feature folders

Each domain has a `features/<domain>/` folder:

- `sessions/` — the sessions sidebar.
- `workspace/` — workspace selection plus the center column (`CenterWorkspace`,
  `Composer`, `ConversationView`).
- `activity/` — the right drawer and rail (Files, Changes, Tasks, Activity, Console,
  Terminal tabs).
- `git/` — the git workspace (status, diffs, history, branches, checkpoints).
- `terminal/` — the integrated terminal and agent command blocks.
- `memory/` — the Memory panel.
- `agent/` — agent status, diagnostics, permission UI.
- `command-palette/` — `Mod+K` launcher.
- `settings/` — the settings modal.

## Commands and shortcuts

[`lib/commands.ts`](../../src/renderer/lib/commands.ts) is the command registry; runs
operate on store `getState()`. `useKeyboardShortcuts` binds combos, `CommandPalette`
lists them, and `useCommandBridge` runs commands dispatched from the native menu /
tray via `command:invoke`. See [the commands reference](../reference/commands.md).

## Styling

[`styles/index.css`](../../src/renderer/styles/index.css) holds the Tailwind v4
`@theme` tokens and the dark-only enforcement. See
[design tokens](../reference/design-tokens.md). The renderer is transpiled by esbuild
via Vite; verify with `npx vite build --config vite.renderer.config.mts`, not `tsc`.

## The streaming timeline

The conversation is folded from the agent snapshot into a chronological, turn-grouped
timeline in `ConversationView`. This is a renderer-only concern; there is no separate
streaming manager. See [data flow](data-flow.md).
