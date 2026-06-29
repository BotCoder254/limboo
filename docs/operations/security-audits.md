# Security audits

This page is the maintainer's checklist for periodically auditing Limboo's security
posture. The model itself is documented in
[the security model](../architecture/security-model.md); this is the operational
routine that keeps it intact.

## Automated checks

- **CodeQL** runs on pushes, PRs, and a weekly schedule
  ([`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)). Triage
  findings in the Security tab.
- **Dependabot** opens weekly dependency PRs; review security advisories promptly.
  See [dependency updates](dependency-updates.md).

## Periodic manual review

Re-verify the ten hardening patterns have not regressed:

1. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in
   [`createWindow.ts`](../../src/main/window/createWindow.ts).
2. The `handle()` wrapper still validates sender origin
   ([`ipc/registry.ts`](../../src/main/ipc/registry.ts)) and every handler uses it.
3. `hardenSession()` still denies all web-platform permissions.
4. Navigation (`will-navigate` / `will-redirect`), window-open, and `<webview>`
   lockdown are intact.
5. The production CSP is still `self`-only with no eval.
6. Git and terminal spawns are still argv-only (no `shell: true`).
7. Every renderer-supplied path is still guarded (`assertInsideRepo`,
   `isInsideRoot`).
8. All SQL still uses bound parameters.
9. Prototype-pollution keys are still rejected from merged / keyed objects.
10. Secrets are still redacted before logging; embedded-credential remote URLs are
    redacted from git results.

Also confirm input caps in [`src/shared/constants.ts`](../../src/shared/constants.ts)
still bound prompts, messages, reads, diffs, scrollback, and the diagnostics ring.

## When adding capability

Any new code that touches the OS must uphold the contracts in
[the security model](../architecture/security-model.md) and
[`CLAUDE.md`](../../CLAUDE.md) §6. In review, treat the security checklist in the PR
template as mandatory for main-process changes.

## Handling reports

Vulnerability reports come through [SECURITY.md](../../SECURITY.md) (private GitHub
advisory or email). Acknowledge, reproduce, fix on `main`, and coordinate disclosure.
Record the fix in [CHANGELOG.md](../../CHANGELOG.md).

## Future considerations

A standalone Permission System beyond the agent's per-tool `canUseTool` gate is
planned; secret storage should use Electron `safeStorage` (never plaintext) and any
future outbound `fetch` must enforce an SSRF allowlist. See
[ROADMAP.md](../../ROADMAP.md).
