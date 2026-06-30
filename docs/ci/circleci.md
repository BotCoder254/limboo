# CircleCI

Defined in [`.circleci/config.yml`](../../.circleci/config.yml). Same stages, order and
artifacts as the other providers, via the same `ci/scripts/*.mjs`. Reusable `commands`
and `executors` keep jobs DRY and consistent.

## Workflows

- **ci** — runs on every push: `validate` -> `build` -> `test`.
- **release** — runs only for `v*` tags: `validate` -> `build` -> `test` -> `package`
  -> `release`. Tag filters require `branches: ignore` so the workflow fires on the tag,
  not the branch.

## Prerequisites

- The project set up on CircleCI and connected to GitHub via the **GitHub App** (the
  recommended integration), not a legacy user key.
- The `cimg/node:20.18` convenience image (used by the `node-linux` executor) ships a
  build toolchain; the config installs `build-essential python3` plus packaging deps
  (`rpm fakeroot dpkg`) and test deps (`xvfb`, GTK/NSS libs) as needed.

## Secrets — Contexts and Project Environment Variables

Store credentials in a **Context** (organization-level, shareable, auditable) or
**Project Environment Variables** — never in `config.yml`.

The `release` job references the `limboo-release` context, which must provide:

| Variable | Use |
| -------- | --- |
| `GITHUB_TOKEN` | a **fine-grained PAT** (or GitHub App token) with `contents: write` on the repo, used by `gh release create` |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*` | macOS signing (optional) |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Windows signing (optional) |

Restrict the context to the maintainer group so secrets are not exposed to fork or PR
pipelines.

## macOS / Windows installers

The default executor is Linux. To produce signed macOS/Windows installers, add jobs that
use CircleCI's `macos` and `windows` executors (these require the corresponding plan/orb)
and run `npm run make` there, then `persist_to_workspace` so the `release` job can attach
all platforms' artifacts.

## Authentication note

As with the other providers, automation authenticates through CircleCI-managed secrets,
not a developer's local `gh` login. The local `gh` CLI remains for manual workflows only.
