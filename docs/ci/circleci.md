# CircleCI

Defined in [`.circleci/config.yml`](../../.circleci/config.yml) (the default
auto-discovered path — if the project ever had **Project Settings -> Advanced ->
Config File** pointed at the old `deploy.yml` name, remove that override).

CircleCI is this repo's **primary release publisher**: on every `v*` tag it
packages the branded installers on all three OSes and publishes the GitHub
Release, including the `latest*.yml` + `*.blockmap` metadata electron-updater
reads. GitHub Actions' [`release.yml`](../../.github/workflows/release.yml) is a
manually-dispatched fallback only — it has no tag trigger, so the two publishers
can never race on the same release.

## Workflows

- **ci** — runs on every branch push: `validate` -> `build` -> `test`, the same
  stages from [`ci/pipeline.yml`](../../ci/pipeline.yml) via the same
  `ci/scripts/*.mjs` the other providers use. These jobs carry no tag filters,
  so they never run for tags.
- **release** — runs ONLY for `v*` tags (every job in the chain declares
  `filters: { tags: { only: /^v.*/ }, branches: { ignore: /.*/ } }` — CircleCI
  silently skips tag pipelines otherwise):
  - `package-linux` — docker `cimg/node:22.12` + rpm/fakeroot/dpkg; builds
    AppImage/deb/rpm and generates the release SBOM (`@cyclonedx/cyclonedx-npm`,
    lockfile-based, so one SBOM covers all OSes).
  - `package-windows` — `circleci/windows` orb (windows-server-2022 machine
    executor, VS2022 toolchain); Node 22 via the preinstalled nvm-windows;
    builds the branded NSIS installer.
  - `package-macos` — `macos` executor (`m4pro.medium`, the free-plan Apple
    silicon class); builds dmg + zip. **arm64-only for now** — Intel Macs can't
    install or auto-update until an x64 mac job is added.
  - `publish-release` — attaches all three staging dirs, consolidates
    `SHA256SUMS`, generates release notes, and publishes the GitHub Release with
    a pinned `gh` CLI (idempotent: re-runs upload missing assets with
    `--clobber`). Tags containing `-` publish as pre-releases. Deploy markers
    (`circleci run release plan/update`) are logged best-effort.

## Prerequisites

- The project set up on CircleCI and connected to GitHub via the **GitHub App**
  (the recommended integration), not a legacy user key.
- An organization **Context** named `limboo-release` containing:
  - `GH_TOKEN` — a fine-grained GitHub PAT scoped to `BotCoder254/limboo` with
    **Contents: Read and write** (releases live under contents). CircleCI has no
    tokenless release path; the GitHub App connection only authorizes builds and
    commit statuses, not `contents: write`.
  - `CIRCLECI_CLI_TOKEN` (optional) — a CircleCI personal API token, only needed
    for the deploy markers to actually record; without it they no-op.
- The `cimg/node:22.12` convenience image (used by the `node-linux` executor)
  ships a build toolchain; the config installs `build-essential python3` plus
  test deps (`xvfb`, GTK/NSS libs) as needed.

## Authentication note

As with the other providers, automation authenticates through CircleCI-managed
secrets (the context above), never a developer's local `gh` login. The local `gh`
CLI remains for manual workflows only.
