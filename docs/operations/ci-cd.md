# CI/CD

This page is the operations-level overview of the repository automation. Limboo runs
a **provider-agnostic CI/CD platform** — one logical pipeline whose logic lives in
provider-neutral scripts — but **GitLab is the single source of truth and primary
release publisher** ([`.gitlab-ci.yml`](../../.gitlab-ci.yml)); GitHub Actions under
[`.github/`](../../.github) provides the CI/Security/CodeQL layers plus a
manual-dispatch release fallback. The full, provider-specific documentation lives in
[`docs/ci/`](../ci/README.md); the canonical pipeline contract is
[`ci/pipeline.yml`](../../ci/pipeline.yml). The pipeline is layered:
**CI** (validate -> build -> test on every push/PR) ->
**CD** (package + SBOM + checksums + signing) ->
**Release** (tag-triggered notes + GitLab Release + an identical GitHub Release,
published by GitLab, with provenance attestations available on the GitHub Actions
fallback path).

## Workflows

### CI (`.github/workflows/ci.yml`)

Runs on pushes and pull requests to `main` as three fail-fast jobs:

- **validate** — `npm run lint`, license compliance, Electron security invariants,
  manifest/docs integrity, dependency audit.
- **build** — renderer build + `npm run package` (compiles main + preload).
- **test** — Electron smoke launch across Ubuntu, macOS and Windows.

It does **not** run `tsc`, by design (TypeScript is ~4.5; the renderer is
esbuild-bundled). The reusable logic lives in [`ci/scripts/`](../../ci/scripts) so all
three providers run identical behavior. Node 22, npm caching, in-progress cancellation
per ref. See [docs/ci/local-testing.md](../ci/local-testing.md) to reproduce locally.

### Security (`.github/workflows/security.yml`)

Secret scanning (gitleaks), dependency review on PRs, `npm audit`, and a CycloneDX SBOM
artifact — on push/PR plus a weekly schedule. See [docs/ci/security.md](../ci/security.md).

### CD and Release

**GitLab is the primary release pipeline**: the `release` stage in
[`.gitlab-ci.yml`](../../.gitlab-ci.yml) triggers on every `v*` tag, packages
installers on Linux (shared runner) plus Windows/macOS (SaaS runners), and publishes
the **same build** to both a GitLab Release and a GitHub Release (installers,
`latest*.yml` + `*.blockmap` auto-update metadata, `SHA256SUMS`, SBOM). The GitHub
repo is kept in sync by GitLab push mirroring. On the GitHub Actions side,
`_package.yml` is the reusable build (matrix, SBOM, checksums, signing verification,
provenance/SBOM attestations); `cd.yml` invokes it as a manual dry-run and
`release.yml` is a **manual-dispatch fallback publisher** (no tag trigger, so it can
never race the GitLab pipeline). See
[docs/ci/release-process.md](../ci/release-process.md).

### CodeQL (`.github/workflows/codeql.yml`)

Static analysis for `javascript-typescript` on pushes and PRs to `main`, plus a
weekly scheduled scan. Results surface in the repository Security tab.

## Dependabot (`.github/dependabot.yml`)

Weekly updates for the npm and github-actions ecosystems, grouped into production and
development dependency PRs. Electron and Vite are ignored on purpose — they are
pinned and bumped deliberately because of the toolchain coupling documented in
[`CLAUDE.md`](../../CLAUDE.md). See
[dependency updates](dependency-updates.md).

## Issue and PR templates

- Issue forms live under `.github/ISSUE_TEMPLATE/` (bug report, feature request,
  documentation), with `config.yml` disabling blank issues and linking Discussions
  and private security reporting.
- The pull-request template (`.github/PULL_REQUEST_TEMPLATE.md`) prompts for
  verification, the security checklist, screenshots, architectural reasoning, and a
  changelog entry.

## CODEOWNERS

`.github/CODEOWNERS` routes review requests to the maintainer.

## Planned

A documentation link-check is a natural future addition. The release-on-tag pipeline
and multi-OS installer matrix now ship in [`.gitlab-ci.yml`](../../.gitlab-ci.yml)
(code signing activates when signing material is added); see
[packaging and signing](packaging-and-signing.md) and
[ROADMAP.md](../../ROADMAP.md).
