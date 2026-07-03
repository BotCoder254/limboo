# Main process

The main process is the OS owner: it boots the app, owns every manager, opens the
database, hardens the session, and wires the subsystems together. This page explains
the boot sequence and the cross-manager wiring. The entry point is
[`src/main/index.ts`](../../src/main/index.ts).

## Boot sequence

1. **Hardware / theme** — software-compositing workarounds where needed;
   `nativeTheme.themeSource = 'dark'` so native chrome matches the renderer.
2. **Single-instance lock** — a second launch focuses the existing window instead of
   starting a new app.
3. **Eager managers** — `WindowStateManager`, `AppMenuManager`, `TrayManager`.
4. **After `app.whenReady()`** (lazy, so app paths resolve):
   - `SettingsManager`, then `NotificationManager(settings)`.
   - **Database** — `getDb()` opens SQLite before any manager reads it.
   - `WorkspaceManager`, `SessionManager`,
     `WorktreeManager(workspace, sessions, settings)`,
     `ServiceManager(sessions, settings)` + `ProxyServer(services, settings)`,
     `AgentManager(workspace, settings, notifications)`,
     `FileSystemManager(workspace)`, `TerminalManager(workspace, settings)`,
     `GitManager(workspace, settings)`, `MemoryManager(settings)`.
   - `registerAllIpc(...)` wires every handler.
   - `worktrees.recover()` runs once (flag vanished checkouts, `git worktree
     repair` + `prune` per repo), then the effective root is targeted.
   - The window is created (see [the window](#window-creation)).

## Cross-manager wiring

Managers own one responsibility each but cooperate through explicit, post-
construction wiring (no hidden globals):

- `agent.setTerminalManager(terminal)` — mirror shell commands into the integrated
  terminal.
- `agent.setSessionManager(sessions)` — auto-title untitled sessions from the first
  prompt.
- `agent.setGitManager(git)` — auto-checkpoint before changes; refresh git live.
- `agent.setMemoryManager(memory)` — retrieve and inject relevant memories.
- `git.setMemoryManager(memory)` — commits become memory proposals.
- `fileSystem.setSessionManager(sessions)` — push live git status into session rows.
- `fileSystem.setGitManager(git)` — notify git on tree changes.
- `services.setTerminalManager(terminal)` / `services.setConfigSource(worktrees)`
  and `worktrees.setTerminalManager(terminal)` / `worktrees.setServiceManager(services)`
  — services spawn through PTYs, read the acknowledged limboo.json from the
  Worktree Manager, and are stopped before a worktree is removed.
- `worktrees.setReleaseRootHook(...)` — the watcher / search index are
  retargeted off a worktree directory before it is deleted (Windows EBUSY).
- The **effective-root resolvers** (`worktrees.resolveSessionRoot` /
  `resolveActiveRoot`) are injected into the Agent, Terminal, Git, Search, and
  File System managers so every subsystem executes in the session's worktree
  when it owns one.

This wiring is the map of how the subsystems interact; each is documented on its own
[subsystem page](subsystems/agent-manager.md).

## Active-workspace lifecycle

`workspace.onActiveChanged(...)` drives in-process reactions when the active
workspace changes: the File System Layer tears down the old watcher and starts
watching/indexing the new root, and the Memory System seeds starter memories for the
workspace on first activation (idempotent).

`retargetEffectiveRoot()` runs on active-workspace **and** active-session
changes: it retargets the single file watcher, invalidates the git root cache,
reindexes search against the session's effective root, and auto-starts the
session's `autoStart` services (acknowledged configs only). The `ProxyServer`
re-syncs with settings changes (`proxy.sync()`).

## Maintenance and shutdown

- `memory.sweep()` runs once at boot and then hourly to flag stale, unpinned
  memories (never deletes).
- `before-quit` cleans up: `agent.cleanup()`, `fileSystem.dispose()`,
  `proxy.stop()`, `services.dispose()` (kills every supervised service),
  `terminal.dispose()`, timers cleared, `tray.destroy()`, `closeDb()`.

## Session hardening

`hardenSession()` applies the Content-Security-Policy (strict `self`-only in
production; relaxed for Vite HMR in development) and denies all web-platform
permission requests and checks (camera, microphone, geolocation, USB, and so on).
See [the security model](security-model.md).

## Window creation

The window is created in
[`src/main/window/createWindow.ts`](../../src/main/window/createWindow.ts):
frameless (`frame: false`), `backgroundColor: '#000000'`, shown only on
`ready-to-show` to avoid a white flash, `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webSecurity: true`. Navigation (`will-navigate` /
`will-redirect`) is locked to the dev-server origin or `file://`, the window-open
handler denies in-app navigation (external links open in the OS browser), and
`<webview>` attachment is blocked. Geometry is persisted and restored by
[`windowState.ts`](../../src/main/window/windowState.ts).

## Utilities

- [`logger.ts`](../../src/main/logger.ts) — structured logging with secret
  redaction and global uncaught handlers.
- [`storage.ts`](../../src/main/storage.ts) — atomic JSON read/write under
  user-data.
- [`paths.ts`](../../src/main/paths.ts) — asset path resolution.
- [`sendCommand.ts`](../../src/main/sendCommand.ts) — native menu / tray ->
  renderer command bridge.
