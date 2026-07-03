# Release process

A release is driven entirely by a version tag. **GitLab is the primary publisher** —
its pipeline runs automatically on every `v*` tag and publishes the **same build** to
both a GitLab Release and a GitHub Release. GitHub Actions' `release.yml` is a manual
fallback (dispatch-only, no tag trigger).

## 0. Checklist — cutting a release (avoid the empty-release trap)

A release only ever contains **the code at the tagged commit**. Two mistakes ship a
release with *no new code*: tagging an old commit, or reusing a commit that already
has a tag (this is exactly how `v1.2.8` and `v1.2.9` ended up identical). Run through
this every time:

1. Merge the work into `main` and let CI go green.
2. `git fetch origin && git checkout main && git pull` — make sure your local `main`
   is **not stale** (it must equal `origin/main`).
3. Confirm the intended tip: `git log --oneline -1 origin/main` shows the commit you
   expect to ship.
4. Pick the **next unused** `vX.Y.Z` (`git tag -l | sort -V | tail`), and check the
   tip isn't already tagged: `git tag --points-at origin/main` must be empty.
5. Tag that commit and push (see §2).
6. Watch the GitLab pipeline (Project → Build → Pipelines) run
   `validate → build → test → package → secure → release`.
7. Verify **both** Releases carry installers + `latest*.yml` (see §5).

Never reuse a version, never tag an old commit, never hand-edit `package.json`. The
`compliance` job runs [`check-tag-unique.mjs`](../../ci/scripts/check-tag-unique.mjs),
which **fails the pipeline** if the tagged commit already carries another `v*` tag —
so a duplicate tag can no longer silently ship an empty release.

## 1. Pre-flight

- The GitLab project is set up: `GH_TOKEN` is a masked+protected CI/CD variable, the
  `v*` tag is protected, and (optionally) SaaS macOS/Windows runners are enabled.
  See [gitlab-ci.md](gitlab-ci.md#first-time-setup).
- GitHub push mirroring is configured so the repo stays in sync.
- `main` is green (GitLab `validate` -> `build` -> `test` passing).
- **Do NOT hand-edit `package.json` version.** Versioning is tag-driven: CI stamps the
  tag version into `package.json` at build time via
  [`apply-tag-version.mjs`](../../ci/scripts/apply-tag-version.mjs). Just use Conventional
  Commit subjects throughout the cycle so release notes are categorized automatically.

## 2. Tag

```bash
git tag -a v1.2.0 -m "Limboo v1.2.0"   # tag the tip of an up-to-date main
git push origin v1.2.0
```

`git push origin` fans out to GitLab (source of truth) and GitHub (mirror); the `v*`
tag triggers the GitLab release pipeline, which derives the version **from the tag** —
every artifact (`app.getVersion()`, installers, `latest*.yml`) is `1.2.0` with no manual
`package.json` bump. The repo's `package.json` version is only a dev/baseline placeholder.

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
