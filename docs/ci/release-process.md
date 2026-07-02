# Release process

A release is driven entirely by a version tag. **CircleCI is the primary
publisher** — its `release` workflow runs automatically on every `v*` tag. GitHub
Actions' `release.yml` is a manual fallback (dispatch-only, no tag trigger).

## 1. Pre-flight

- `main` is green (CircleCI `ci` workflow passing; GH Actions CI/Security/CodeQL
  too, once account billing is fixed).
- One-time setup: the CircleCI project is connected via the GitHub App and the
  `limboo-release` context defines `GH_TOKEN` — see [circleci.md](circleci.md).
- Update the version in `package.json` (e.g. `1.2.0`) and commit. Use Conventional
  Commit subjects throughout the cycle so release notes are categorized automatically.

## 2. Tag

```bash
git tag v1.2.0
git push origin v1.2.0
```

The tag (`v*`) triggers the CircleCI `release` workflow.

## 3. What the pipeline does

1. `package-linux` / `package-windows` / `package-macos` each run `npm run dist`
   (Forge package + electron-builder branded installers + `latest*.yml`
   auto-update metadata) on their own OS; Linux additionally generates the SBOM
   (CycloneDX). See [installer and updates](../operations/installer-and-updates.md).
2. `publish-release` collects every platform's artifacts, consolidates a top-level
   `SHA256SUMS`, generates `RELEASE_NOTES.md` from commits since the previous tag,
   and creates the GitHub Release with all installers, the `latest*.yml` +
   `*.blockmap` auto-update metadata, the SBOM, and checksums attached.
3. Tags containing a hyphen (e.g. `v1.2.0-rc.1`) are published as **pre-releases**
   — use one as a dry run before the first real tag.
4. macOS installers are **arm64-only** for now (the runner is Apple silicon).

## 4. Release notes

[`generate-release-notes.mjs`](../../ci/scripts/generate-release-notes.mjs) groups
Conventional-Commit subjects into Features / Performance / Bug Fixes / Security /
Refactoring / Documentation / Build & CI / Dependencies / Maintenance, surfaces
`BREAKING CHANGE`, and credits contributors. To preview locally:

```bash
node ci/scripts/generate-release-notes.mjs v1.2.0
```

## 5. Verifying a published release

```bash
sha256sum -c SHA256SUMS
```

Build-provenance attestations (`gh attestation verify …`) are only minted by the
GitHub Actions fallback path — CircleCI has no equivalent of `actions/attest-*`.

## 6. Fallback: GitHub Actions

If CircleCI is unavailable: **Actions -> Release (manual fallback) -> Run
workflow**, entering the existing `v*` tag. It reuses `_package.yml` (with
attestations) and publishes the same artifact set. Never run both paths for the
same tag on purpose; if it happens, the second run only re-uploads assets.

## 7. Optional GitLab mirror

If a GitLab mirror is configured, the tag also produces a GitLab Release via the
`release` stage in `.gitlab-ci.yml`.

## Rollback

Releases are immutable artifacts. To withdraw a bad release: mark the GitHub Release as a
draft or delete it, delete the tag (`git push --delete origin v1.2.0`), fix forward, and
cut a new patch tag. Never reuse a version number.
