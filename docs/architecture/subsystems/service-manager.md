# Subsystem: Service Manager

## Purpose

The Service Manager supervises **Scripts & Services** declared by the repo's
`limboo.json` (see the [reference](../../reference/limboo-json.md)): named
on-demand scripts (test, lint, migrate) and long-running services (dev servers,
APIs, workers) owned by a session. Services get an auto-assigned loopback port,
a restart policy, live status, and logs streamed through the integrated
terminal — the PTY scrollback IS the structured log. See the
[Git workflow guide](../../guides/git-workflow.md).

Source: [`src/main/managers/services/ServiceManager.ts`](../../../src/main/managers/services/ServiceManager.ts)
(+ [`ProxyServer.ts`](../../../src/main/managers/services/ProxyServer.ts)).

## Responsibilities

- List declared + running services per session (declared ones show `stopped`;
  running services whose declaration disappeared stay stoppable).
- Start/stop/restart supervised services: probe-allocate a free 127.0.0.1 port
  in the configured range, spawn the command through
  `TerminalManager.createForCommand` (PTY, `origin: 'service'`), track status
  (`starting/running/exited/crashed/stopped`).
- Restart policy: `on-failure` respawns with exponential backoff, capped at
  `WORKTREE_LIMITS.maxRestarts`; a respawn that stays healthy past ~60s earns
  its budget back. A stale exit event from a replaced PTY (restart race) is
  ignored via a terminal-id guard.
- Peer discovery: sibling services of the same session see each other via
  `LIMBOO_SERVICE_<NAME>_PORT/_URL` env vars (loopback only), plus their own
  `PORT`/`LIMBOO_PORT`/`LIMBOO_SERVICE_NAME`/`LIMBOO_SESSION_ID`.
- Run on-demand scripts in the session's effective root (visible terminal).
- `autoStartForSession` starts `autoStart: true` services on session
  activation (acknowledged configs only); `stopForSession` tears everything
  down on worktree removal / session delete; `dispose()` on app quit.

## Public surface (key methods)

- `listForSession(sessionId)`, `start/stop/restart(sessionId, name)`
- `runScript(sessionId, name)`, `stopForSession(sessionId)`,
  `autoStartForSession(sessionId)`, `dispose()`
- `resolveProxyTarget(hostKey)` — registry lookup for the reverse proxy

Reached via the `service:*` channels and `script:run`.

## The localhost proxy

`ProxyServer` (opt-in: `git.services.proxyEnabled`) runs one loopback HTTP
server on `git.services.proxyPort` that maps
`http://<service>--<slug>.localhost:<port>` to the owning service's
`127.0.0.1` port via a pure registry lookup (HTTP + WebSocket upgrade; 404 on
any unknown host). The slug is the worktree directory basename (plain sessions
use a session-id prefix), so each session's services get stable, bookmarkable
hostnames. Note: dev servers that validate the `Host` header (e.g. Vite
`server.allowedHosts`) may need the `*.localhost` host allowed.

## Dependencies and wiring

Constructed with the Session and Settings managers; the Terminal Manager and
the Worktree Manager (config source + effective-root resolver) are attached
after construction via narrow interfaces. The Worktree Manager calls
`stopForSession` before removing a worktree; the session delete handler calls
it unconditionally.

## Data flow

`services:updated` (per-session `ServiceInfo[]`) is pushed to the renderer on
every genuine lifecycle transition (start/stop/exit/restart) — never on reads —
and `useServiceStore` mirrors it into the `ServicesStrip` under the session
header. The strip's controls stay disabled until the repo config is
acknowledged (a "Review commands…" affordance opens the approval dialog).

## Security boundary

Commands are repo/user-authored config, never renderer-composed, and are inert
until the workspace acknowledges the exact config hash (the same trust gate as
setup/teardown hooks — enforced main-side in `requireAckedConfig`). Execution
is argv-only PTYs via the Terminal Manager; ports are probed and bound on
`127.0.0.1` exclusively; the proxy can never be steered to an arbitrary
upstream (registry lookup, loopback targets only); peer-discovery env carries
only loopback URLs; service names are whitelist-validated (`[a-z0-9-]`).
Port probe→bind is TOCTOU-racy by design (accepted for local dev); a lost race
surfaces as the service's own bind error in its terminal. See
[the security model](../security-model.md).
