# Reference: limboo.json

A repo may ship a `limboo.json` at its root declaring commands Limboo can run
for a session: **setup/teardown hooks**, **named scripts**, and **supervised
services**. The source of truth is
[`src/main/managers/worktree/config.ts`](../../src/main/managers/worktree/config.ts)
(parsing/validation) and the `RepoConfig` / `RepoServiceConfig` types in
[`src/shared/types.ts`](../../src/shared/types.ts).

```json
{
  "setup": ["npm ci", "node scripts/copy-env.mjs"],
  "teardown": ["node scripts/cleanup.mjs"],
  "scripts": {
    "test": "npm test",
    "lint": "npm run lint"
  },
  "services": {
    "web": { "command": "npm run dev", "autoStart": true, "restart": "on-failure" },
    "api": "npm run api"
  }
}
```

## Fields

| Field | Shape | Notes |
| ----- | ----- | ----- |
| `setup` | `string[]` | Hook commands run sequentially in a fresh worktree (install deps, copy `.env`, …). A failing step aborts the rest. |
| `teardown` | `string[]` | Best-effort hooks run before a worktree is removed / archived. |
| `scripts` | `Record<name, command>` | On-demand commands (test, lint, migrate) — run buttons in the Services strip; each opens a visible `Script: <name>` terminal. |
| `services` | `Record<name, string \| object>` | Long-running processes supervised for the session's lifetime. A plain string is shorthand for `{ command }`. |

Service object fields: `command` (required), `autoStart` (default `false` —
start on session activation), `restart` (`"no"` default, or `"on-failure"` —
exponential-backoff respawn capped at `WORKTREE_LIMITS.maxRestarts`).

Validation bounds (`WORKTREE_LIMITS` in
[`constants.ts`](../../src/shared/constants.ts)): file ≤ 64 KB; names match
`[a-z0-9][a-z0-9-]{0,31}`; commands ≤ 2048 chars; ≤ 16 hook/script commands and
≤ 8 services; prototype-pollution keys are rejected. Invalid entries are
silently dropped; an unparseable file is treated as absent.

## Trust model (acknowledgment gate)

`limboo.json` is **repo-authored and therefore untrusted** until the user
approves it. The approval dialog shows every executable command verbatim; a
SHA-256 hash over the executable portions (setup + teardown + scripts +
services, canonicalized) is what gets acknowledged and persisted per workspace
(`hooksAckHash`).

- Nothing runs before the ack: setup/teardown hooks, scripts, and services all
  fail closed (`worktree:runSetup` verifies the hash; the Service Manager's
  `requireAckedConfig` gates every start/run).
- **Any edit re-requires confirmation**: the stored hash no longer matches, so
  hooks/services lock again until the config is re-reviewed (the Services
  strip shows a "Review commands…" affordance).
- The ack is TOCTOU-safe: the hash sent with the confirmation must equal the
  hash of the config *currently on disk*, so a file edited between display and
  approval is rejected.
- Repos without setup hooks are acknowledged the same way (`worktree:ackConfig`)
  — declaring only scripts/services still triggers the approval dialog.

## Environment provided to commands

Setup/teardown hooks (run inside the worktree):

| Variable | Value |
| -------- | ----- |
| `LIMBOO_WORKTREE` | `1` |
| `LIMBOO_SOURCE_ROOT` | the workspace's main checkout (copy ignored files from here) |
| `LIMBOO_BRANCH` | the worktree branch |
| `LIMBOO_SESSION_ID` | owning session id |

Services (run in the session's effective root):

| Variable | Value |
| -------- | ----- |
| `PORT` / `LIMBOO_PORT` | the auto-assigned loopback port |
| `LIMBOO_SERVICE_NAME` | this service's name |
| `LIMBOO_SESSION_ID` | owning session id |
| `LIMBOO_SERVICE_<NAME>_PORT` / `_URL` | each already-running sibling service of the same session (loopback only) |

With the proxy enabled (`git.services.proxyEnabled`), each running service is
also reachable at `http://<service>--<slug>.localhost:<proxyPort>` — see
[the Service Manager](../architecture/subsystems/service-manager.md).
