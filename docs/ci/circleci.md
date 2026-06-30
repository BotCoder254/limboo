# CircleCI

Defined in [`.circleci/deploy.yml`](../../.circleci/deploy.yml). **CI-only**: it runs
the `validate -> build -> test` stages from [`ci/pipeline.yml`](../../ci/pipeline.yml)
on every push, via the same `ci/scripts/*.mjs` GitHub Actions and GitLab CI use.
Reusable `commands` and an `executor` keep jobs DRY and consistent.

CircleCI does **not** package, sign, or publish releases in this repo. GitHub Actions'
[`release.yml`](../../.github/workflows/release.yml) is the sole release publisher —
see [github-actions.md](github-actions.md) and [release-process.md](release-process.md).
That keeps CircleCI simple (one Linux executor, no signing secrets, no release token)
and avoids the two structural limits a CircleCI-driven release would hit here: its
default executor is Linux-only (macOS/Windows installers would need additional
`circleci/macos` / `circleci/windows` orb-based jobs), and publishing a GitHub Release
from CircleCI still requires a manually-stored token — connecting a CircleCI project to
GitHub via the GitHub App only authorizes triggering builds and posting commit
statuses, it does **not** grant `contents: write` to create releases.

## Workflows

- **ci** — runs on every push: `validate` -> `build` -> `test`.

## Prerequisites

- The project set up on CircleCI and connected to GitHub via the **GitHub App** (the
  recommended integration), not a legacy user key.
- The `cimg/node:22.12` convenience image (used by the `node-linux` executor) ships a
  build toolchain; the config installs `build-essential python3` plus test deps
  (`xvfb`, GTK/NSS libs) as needed.
- **Project Settings -> Advanced -> Config File** must point at `.circleci/deploy.yml`
  (CircleCI's default auto-discovery only looks for `.circleci/config.yml`; this repo
  uses the non-default filename, so the custom path is required for builds to run at
  all).

## If you want CircleCI to also package or release

This isn't configured today, but if you want parity with GitHub Actions later:

1. Add `circleci/macos` and `circleci/windows` orb-based jobs (alongside the existing
   `node-linux` executor) so all three OSes get packaged — `npm run dist -- --publish
   never` works the same on every executor.
2. Store a fine-grained GitHub PAT (or GitHub App installation token) as `GITHUB_TOKEN`
   in a CircleCI **Context** (organization-level, shareable, auditable) restricted to
   the maintainer group, and reference it from a `release` job's `context:`. CircleCI
   has no tokenless release path — this step is unavoidable on this platform.
3. Mirror the `package`/`release` job shape already implemented in
   [`_package.yml`](../../.github/workflows/_package.yml) and
   [`release.yml`](../../.github/workflows/release.yml) so artifacts and release notes
   stay identical across providers.

## Authentication note

As with the other providers, automation should authenticate through CircleCI-managed
secrets, not a developer's local `gh` login. The local `gh` CLI remains for manual
workflows only.
