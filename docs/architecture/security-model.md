# Security model

Limboo is local-first, which makes its attack surface small, and it is hardened in
depth so that even a compromised renderer cannot reach the OS. This page consolidates
the threat model and the enforcement patterns. None of these may be weakened by a
change. The user-facing summary is [SECURITY.md](../../SECURITY.md).

## Threat model in one paragraph

There is no backend, no telemetry, and no stored credentials, so there is no server
to attack and little secret material to steal. The realistic threats are: a
compromised or buggy renderer trying to reach the OS; malicious input crossing IPC;
path traversal escaping the workspace; injection through SQL or a spawned shell;
prototype pollution through merged objects; and secrets leaking into logs. Each has a
specific, implemented defense.

## The ten hardening patterns

1. **Process isolation** — `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`. The renderer has no Node access; a single typed preload bridge is
   the only path to main.
   ([`createWindow.ts`](../../src/main/window/createWindow.ts))

2. **IPC sender validation** — the `handle()` wrapper rejects any message whose
   sender origin is not the app's own renderer (dev-server origin in dev, `file://`
   in prod). ([`ipc/registry.ts`](../../src/main/ipc/registry.ts))

3. **Deny-by-default permissions** — `hardenSession()` refuses all web-platform
   permission requests and checks (camera, microphone, geolocation, USB, and so on).
   ([`src/main/index.ts`](../../src/main/index.ts))

4. **Navigation and webview lockdown** — `will-navigate` and `will-redirect` are
   guarded, `setWindowOpenHandler` denies in-app navigation (external links open in
   the OS browser), and `<webview>` attachment is blocked.
   ([`createWindow.ts`](../../src/main/window/createWindow.ts))

5. **Content-Security-Policy** — strict `self`-only in production (no eval); relaxed
   only for Vite HMR in development. ([`src/main/index.ts`](../../src/main/index.ts))

6. **No shell execution** — git and the terminal are spawned with argv arrays via
   `execFile` / `node-pty`, never `shell: true`, so there is no shell string to
   inject into. ([`managers/git/exec.ts`](../../src/main/managers/git/exec.ts),
   [`TerminalManager.ts`](../../src/main/managers/TerminalManager.ts))

7. **Path-traversal guards** — every renderer-supplied path is validated to stay
   inside the workspace / repository root, symlink-aware, rejecting absolute paths,
   parent traversal, null bytes, and over-long paths (`assertInsideRepo`,
   `isInsideRoot`).

8. **Parameterized SQL** — only bound statements; values are never concatenated into
   SQL. ([`db/database.ts`](../../src/main/db/database.ts))

9. **Prototype-pollution filtering** — `__proto__` / `constructor` / `prototype`
   keys are rejected from any renderer-supplied object that is merged or used as a
   key (settings, workspace config, permission decisions, and the settings
   deep-merge).

10. **Secret redaction** — secrets and tokens are redacted before anything reaches
    the logger; embedded-credential remote URLs are redacted from git results and
    logs. ([`logger.ts`](../../src/main/logger.ts))

## Input caps

Handlers cap renderer-supplied input lengths (prompts, commit messages, memory
bodies, branch / tag labels, clipboard / URL / notification strings) and bound output
(file reads, diff size, terminal scrollback, diagnostics ring) so a hostile or merely
enormous input cannot stall the main process or exhaust memory. The bounds live in
[`src/shared/constants.ts`](../../src/shared/constants.ts).

## Contracts for new code

Any new code that touches the OS must uphold these contracts (also in
[`CLAUDE.md`](../../CLAUDE.md) §6):

- Validate every renderer-supplied input in the main process.
- Use bound SQL parameters only.
- Spawn with argv arrays; never `shell: true`. Validate every `cwd` / path stays
  inside the workspace before touching the filesystem.
- Apply the prototype-pollution guard to every merged or keyed renderer object.
- Encrypt any secret with Electron `safeStorage`; never plaintext files. Redact
  secrets before logging.
- For any outbound `fetch`, enforce an SSRF allowlist (block private, loopback, and
  link-local ranges; do not follow redirects to internal hosts).

See [the IPC layer](ipc-layer.md) and [the process model](process-model.md).
