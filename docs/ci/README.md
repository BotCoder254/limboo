# CI/CD

Limboo ships a **provider-agnostic** CI/CD platform. One logical pipeline is defined
once in [`ci/pipeline.yml`](../../ci/pipeline.yml) and implemented identically for
three providers, so an organization can adopt whichever CI it already runs without
changing Limboo's development workflow. All three execute the same stages in the same
order and produce the same artifacts, because the actual logic lives in
provider-neutral scripts under [`ci/scripts/`](../../ci/scripts) rather than in YAML.

## Layered responsibilities

| Layer | Trigger | Responsibility | Publishes? |
| ----- | ------- | -------------- | ---------- |
| **CI** | every push / PR | validate -> build -> test | no |
| **CD** | manual / pre-release | package, SBOM, checksums, signing | no |
| **Release** | `v*` tag | notes, GitHub Release (+ optional GitLab) | yes |

In this repo's current implementation, **CircleCI runs all three layers and is the
primary release publisher**: its `release` workflow triggers on every `v*` tag,
packages installers on Linux, Windows, and macOS, and publishes the GitHub Release
(credentialed via the `limboo-release` context — see [circleci.md](circleci.md)).
**GitHub Actions** retains the CI/Security/CodeQL layers plus a **manual-dispatch
release fallback** ([github-actions.md](github-actions.md)); note that Actions on
this private repo is currently blocked at the account level (billing/spending
limit), so nothing GH-side runs until that is resolved. **GitLab CI runs CI-only**
here; its `package`/`release` stages are documented but not wired to a credential.

## Stage order (every provider, fail-fast)

`validate` -> `build` -> `test` -> `package` -> `secure` -> `release`

`validate` runs the cheap, high-signal gates first (lint, license compliance, secret
scan, dependency audit, SAST, Electron security invariants, manifest integrity) so the
expensive `package` step never runs against a tree that already violates project
standards.

## Provider guides

- [github-actions.md](github-actions.md) — primary implementation
- [gitlab-ci.md](gitlab-ci.md)
- [circleci.md](circleci.md)

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
