# Release process

A release is driven entirely by a version tag. **GitLab is the primary publisher** —
its pipeline runs automatically on every `v*` tag and publishes the **same build** to
both a GitLab Release and a GitHub Release. GitHub Actions' `release.yml` is a manual
fallback (dispatch-only, no tag trigger).

## 1. Pre-flight

- The GitLab project is set up: `GH_TOKEN` is a masked+protected CI/CD variable, the
  `v*` tag is protected, and (optionally) SaaS macOS/Windows runners are enabled.
  See [gitlab-ci.md](gitlab-ci.md#first-time-setup).
- GitHub push mirroring is configured so the repo stays in sync.
- `main` is green (GitLab `validate` -> `build` -> `test` passing).
- Update the version in `package.json` (e.g. `1.2.0`) and commit. Use Conventional
  Commit subjects throughout the cycle so release notes are categorized automatically.

## 2. Tag

```bash
git tag v1.2.0
git push origin v1.2.0
```

`git push origin` fans out to GitLab (source of truth) and GitHub (mirror); the `v*`
tag triggers the GitLab release pipeline.

## 3. What the pipeline does

1. `package:linux` / `package:windows` / `package:macos` each run `npm run dist`
   (Forge package + electron-builder branded installers + `latest*.yml` auto-update
   metadata) on their own OS and stage into `artifacts/<os>/`; Linux additionally
   generates the SBOM (CycloneDX). Windows/macOS run on GitLab SaaS runners and are
   optional — a Linux-only release still proceeds. See
   [installer and updates](../operations/installer-and-updates.md).
2. `secure` flattens every platform's artifacts into `dist/`, consolidates a
   top-level `SHA256SUMS`, and verifies signatures.
3. `release-notes` generates `RELEASE_NOTES.md` from commits since the previous tag.
4. `upload:packages` pushes each installer into the GitLab Generic Package Registry
   (so the GitLab Release can link permanent downloads).
5. `release:gitlab` creates the GitLab Release with the notes + linked assets;
   `release:github` creates the identical GitHub Release with all installers, the
   `latest*.yml` + `*.blockmap` auto-update metadata, the SBOM, and checksums
   attached (electron-updater reads `latest*.yml` from the GitHub Release).
6. Tags containing a hyphen (e.g. `v1.2.0-rc.1`) are published as **pre-releases** on
   both hosts — use one as a dry run before the first real tag.
7. macOS installers are **arm64-only** for now (the SaaS runner is Apple silicon).

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

The same `SHA256SUMS` ships on both hosts, so a download from GitLab or GitHub
verifies against identical hashes.

## 6. Fallback: GitHub Actions

If GitLab is unavailable: **GitHub -> Actions -> Release (manual fallback) -> Run
workflow**, entering the existing `v*` tag. It reuses `_package.yml` (with
provenance attestations) and publishes the same artifact set to GitHub. Never run
both paths for the same tag on purpose; if it happens, the second run only
re-uploads assets. Build-provenance attestations (`gh attestation verify …`) are
only minted by this GitHub Actions path.

## Rollback

Releases are immutable artifacts. To withdraw a bad release: delete/draft the
Release on **both** GitLab and GitHub, delete the tag
(`git push --delete origin v1.2.0` — fans out to both hosts), fix forward, and cut a
new patch tag. Never reuse a version number.
