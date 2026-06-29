# Security Policy

Limboo is a local-first desktop application with a deliberately small attack surface
and defense-in-depth hardening. This document explains how to report vulnerabilities
and summarizes the security model. The full model is documented in
[docs/architecture/security-model.md](docs/architecture/security-model.md).

## Supported versions

Limboo is pre-stable. Security fixes are applied to the latest released version on
the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | Yes                |
| < 1.0   | No                 |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately by one of:

- GitHub's private vulnerability reporting ("Report a vulnerability" under the
  repository **Security** tab), or
- email to **teumteum776@gmail.com** with the subject line `SECURITY: <summary>`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- The affected version / commit and your platform.
- Any suggested remediation.

You can expect an acknowledgement within a few days. We will work with you on a fix
and coordinate a disclosure timeline. Please give us a reasonable window to release
a fix before any public disclosure.

## Threat surface

Because Limboo is local-first, the threat surface is unusually small:

- **No backend and no telemetry.** Limboo has no server of its own and collects no
  analytics. The only outbound network traffic is the connected coding agent talking
  to its AI provider.
- **No stored credentials.** Limboo never stores agent or remote-git credentials. It
  relies on the coding agent's own authentication and the user's git credential
  helper / SSH agent. Embedded-credential remote URLs are redacted from results and
  logs.
- **Local data.** Sessions, transcripts, memories, and settings are stored locally
  (a SQLite database and JSON files under the OS user-data directory).

## Hardening in place

The following protections are implemented and must not be weakened by any change:

- **Process isolation** — `contextIsolation` on, `nodeIntegration` off,
  `sandbox: true`. The renderer holds no Node access; a single typed preload bridge
  is the only path to the main process.
- **IPC sender validation** — every handler runs through a wrapper that rejects any
  message whose sender origin is not the application's own renderer.
- **Deny-by-default permissions** — all web-platform permissions (camera,
  microphone, geolocation, USB, and so on) are refused.
- **Navigation and webview lockdown** — external navigation and `<webview>`
  attachment are blocked; external links open in the OS browser.
- **Content-Security-Policy** — strict `self`-only policy in production.
- **No shell execution** — git and the terminal are spawned with argv arrays, never
  `shell: true`.
- **Path-traversal guards** — every renderer-supplied path is validated to stay
  inside the workspace/repository root (symlink-aware).
- **Parameterized SQL** — only bound statements; values are never concatenated into
  SQL.
- **Prototype-pollution filtering** — `__proto__` / `constructor` / `prototype` keys
  are rejected from any merged or keyed renderer-supplied object.
- **Secret redaction** — secrets and tokens are redacted before anything reaches the
  logger.

See [docs/architecture/security-model.md](docs/architecture/security-model.md) for
the full breakdown and the file-level enforcement points.
