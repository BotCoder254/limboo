# GitHub Actions

Runs the CI/security/SAST layers plus a **manual release fallback** — the primary
release publisher is GitLab (see [gitlab-ci.md](gitlab-ci.md)). Workflows under
[`.github/workflows`](../../.github/workflows):

| Workflow | Trigger | Purpose |
| -------- | ------- | ------- |
| `ci.yml` | push / PR to `main` | validate -> build -> test (Linux/macOS/Windows) |
| `security.yml` | push / PR / weekly | secret scan, dependency review, audit, SBOM |
| `codeql.yml` | push / PR / weekly | SAST (JavaScript/TypeScript) |
| `cd.yml` | manual dispatch | package + SBOM + checksums (no publish) |
| `release.yml` | manual dispatch (`tag` input) | fallback publisher (primary: GitLab) |
| `_package.yml` | reusable (`workflow_call`) | the shared packaging build |

> The GitHub repository is a **push mirror** of GitLab (the source of truth). These
> Actions run on the mirrored commits and serve as CI + the manual release fallback;
> the primary release publish happens in GitLab. If Actions is blocked at the account
> level (billing/spending limit), fix it in **Settings -> Billing** — the GitLab
> pipeline is unaffected.

`cd.yml` and `release.yml` both call `_package.yml`, so the build instructions exist in
exactly one place. A single reusable build is also the path to SLSA Build L3.

## Prerequisites

- Repository **Actions** enabled.
- For releases: **Settings -> Actions -> General -> Workflow permissions** set to allow
  workflows to create releases, or rely on the per-job `contents: write` already
  declared in `release.yml`.
- `better-sqlite3` may compile from source; the workflows install
  `build-essential python3` on Linux runners. macOS/Windows runners already
  ship a toolchain. `node-pty` (pinned to the Node-API `1.2.0-beta` line) never
  compiles — it loads a bundled, ABI-stable prebuilt and is excluded from
  Electron Forge's native-rebuild pass (`forge.config.ts`).

## Permissions model

Every workflow starts at `permissions: contents: read` and widens per job only where
required:

- `security-events: write` — CodeQL.
- `id-token: write` + `attestations: write` — provenance/SBOM attestation in `_package.yml`.
- `contents: write` — the `publish` job in `release.yml`.
- `pull-requests: write` — dependency review comments.

## Authentication

Automation uses the built-in `GITHUB_TOKEN` plus **OIDC** (`id-token: write`) for
attestations. Do **not** wire the maintainer's local `gh` login into CI — that is for
developer workflows only. No long-lived release credentials are needed for GitHub.

## Secrets (optional, signing only)

Set under **Settings -> Secrets and variables -> Actions** (see
[code-signing.md](code-signing.md)). Without them, builds are unsigned and
`verify-signing.mjs` skips cleanly.

| Secret | Platform |
| ------ | -------- |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Windows |

## Branch protection (recommended)

Require these checks on `main`: `Validate`, `Build`, `Test (ubuntu-latest)`,
`Test (macos-latest)`, `Test (windows-latest)`, `Analyze`, and the `security.yml` jobs.

## Artifacts and attestations

`_package.yml` uploads per-OS artifacts and (on the release path) mints
`actions/attest-build-provenance` + `actions/attest-sbom` attestations. Consumers verify
with:

```bash
gh attestation verify <installer> --repo BotCoder254/limboo
```

Start attestation **consumption** in audit mode; enforce once the pipeline is proven.
