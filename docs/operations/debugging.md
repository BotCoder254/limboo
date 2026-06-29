# Debugging

This page collects the practical entry points for diagnosing problems in Limboo,
across its three processes.

## Logs

The main process writes structured logs via
[`src/main/logger.ts`](../../src/main/logger.ts) to both the console and a log file
under the OS user-data directory. The logger installs global uncaught-exception
handlers and **redacts secrets and tokens** before any line is written — keep that
guarantee when adding log statements.

When filing a bug, include the relevant log lines (redact anything sensitive that the
logger did not). See [SUPPORT.md](../../SUPPORT.md).

## Per-process debugging

- **Renderer** — open the Chromium DevTools for the window. React state lives in the
  Zustand stores; inspect them via the store APIs. The renderer hot-reloads through
  Vite.
- **Main / preload** — these are esbuild bundles; changes require a restart of
  `npm start`. Add log statements through the logger. Use Electron's main-process
  inspector if you need a debugger.
- **IPC** — if a renderer call fails, check the matching handler in
  `src/main/ipc/*Handlers.ts`. The `handle()` wrapper logs thrown errors with their
  channel name and rejects the renderer promise; sender-origin rejections surface
  there too. See [the IPC layer](../architecture/ipc-layer.md).

## The agent diagnostics console

The Agent Manager records a lifecycle / request / recovery / heartbeat timeline in
the `agent_diagnostics` table and exposes it through `agent:getDiagnostics`. The UI
surfaces it as a diagnostics console — the first place to look for agent connectivity,
auth, or rate-limit issues. See
[the Agent Manager](../architecture/subsystems/agent-manager.md).

## Common situations

- **White flash / blank window** — the window is shown on `ready-to-show`; a blank
  window usually means the renderer failed to load. Check the dev-server diagnostic
  page and the console.
- **Dev server unreachable** — the main process retries the Vite dev server on launch
  and shows a diagnostic page if it never comes up. Restart `npm start`.
- **Native module errors** — rebuild after a Node / Electron change; see
  [dependency updates](dependency-updates.md).
- **Database issues** — the SQLite file is `{userData}/limboo.db` (WAL). See
  [the database](../architecture/subsystems/database.md).

## State on disk

For reproducing or clearing state, the user-data directory holds `limboo.db`,
`settings.json`, `window-state.json`, and the log file. See
[Local-first](../concepts/local-first.md).
