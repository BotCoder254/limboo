# CI/CD

Limboo ships a **provider-agnostic** CI/CD platform. One logical pipeline is defined
once in [`ci/pipeline.yml`](../../ci/pipeline.yml) and implemented identically for
three providers — GitLab CI, GitHub Actions, and Bitbucket Pipelines — so an
organization can adopt whichever CI it already runs without changing Limboo's
development workflow. All three execute the same stages in the same order and
produce the same artifacts, because the actual logic lives in provider-neutral
scripts under [`ci/scripts/`](../../ci/scripts) rather than in YAML.

## Layered responsibilities

| Layer | Trigger | Responsibility | Publishes? |
| ----- | ------- | -------------- | ---------- |
| **CI** | every push / PR | validate -> build -> test | no |
| **CD** | manual / pre-release | package, SBOM, checksums, signing | no |
| **Release** | `v*` tag | notes, GitLab Release **and** GitHub Release | yes |

In this repo's current implementation, **GitLab runs all three layers and is the
primary release publisher — the single source of truth**: its `release` stage
triggers on every `v*` tag, packages installers on Linux (shared runner) plus
Windows/macOS (SaaS runners), and publishes the **same build** to both a GitLab
Release and a GitHub Release (credentialed via the masked+protected `GH_TOKEN`
variable — see [gitlab-ci.md](gitlab-ci.md)). The GitHub repository is kept in sync
by GitLab push mirroring, and GitHub Releases still host the electron-updater feed.
**GitHub Actions** retains the CI/Security/CodeQL layers plus a **manual-dispatch
release fallback** ([github-actions.md](github-actions.md)). **Bitbucket
Pipelines** runs the same pipeline on the Bitbucket mirror — CI on every push/PR,
and on `v*` tags a Linux packaging pass that **co-publishes the GitHub Release**
with the same idempotent create-or-clobber logic
([bitbucket-pipelines.md](bitbucket-pipelines.md)).

## Stage order (every provider, fail-fast)

`validate` -> `build` -> `test` -> `package` -> `secure` -> `release`

`validate` runs the cheap, high-signal gates first (lint, license compliance, secret
scan, dependency audit, SAST, Electron security invariants, manifest integrity) so the
expensive `package` step never runs against a tree that already violates project
standards.

## Provider guides

- [gitlab-ci.md](gitlab-ci.md) — **primary** pipeline and release publisher
- [github-actions.md](github-actions.md) — CI/Security/CodeQL + manual release fallback
- [bitbucket-pipelines.md](bitbucket-pipelines.md) — Linux pipeline + GitHub Release co-publisher

## Process guides

- [release-process.md](release-process.md) — cutting a release end-to-end
- [code-signing.md](code-signing.md) — optional macOS / Windows signing
- [security.md](security.md) — supply-chain model and required secrets
- [local-testing.md](local-testing.md) — run the pipeline on your machine
- [troubleshooting.md](troubleshooting.md) — common failures and fixes

## Shared scripts

Every provider calls the same scripts (Node builtins only — no extra install):

| Script | Purpose |
| ------ | ------- |
| [`make-checksums.mjs`](../../ci/scripts/make-checksums.mjs) | `SHA256SUMS` for artifacts |
| [`check-licenses.mjs`](../../ci/scripts/check-licenses.mjs) | dependency license gate |
| [`check-electron-security.mjs`](../../ci/scripts/check-electron-security.mjs) | static Electron security invariants |
| [`check-manifest.mjs`](../../ci/scripts/check-manifest.mjs) | package + docs integrity |
| [`smoke-test.mjs`](../../ci/scripts/smoke-test.mjs) | headless Electron boot + sandbox assertion |
| [`verify-signing.mjs`](../../ci/scripts/verify-signing.mjs) | code-signature verification (skips when unsigned) |
| [`generate-release-notes.mjs`](../../ci/scripts/generate-release-notes.mjs) | categorized notes from git history |
