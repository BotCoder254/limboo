# Release process

A release is driven entirely by a version tag. The same logical flow works on any
provider; GitHub Actions is described here.

## 1. Pre-flight

- `main` is green (CI + Security + CodeQL passing).
- (Optional) Run the CD dry-run: **Actions -> CD -> Run workflow** on `main`, confirm all
  three platforms package, the SBOM and `SHA256SUMS` are produced, and signing verifies
  (or skips cleanly).
- Update the version in `package.json` (e.g. `1.2.0`) and commit. Use Conventional
  Commit subjects throughout the cycle so release notes are categorized automatically.

## 2. Tag

```bash
git tag v1.2.0
git push origin v1.2.0
```

The tag (`v*`) triggers `release.yml`.

## 3. What the pipeline does

1. `_package.yml` runs on Linux, macOS, Windows: `npm run dist` (Forge package +
   electron-builder branded installers + `latest*.yml` auto-update metadata), SBOM
   (CycloneDX), `SHA256SUMS`, signing verification, and **build-provenance + SBOM
   attestations** (`attest: true`). See
   [installer and updates](../operations/installer-and-updates.md).
2. `publish` downloads every platform's artifacts, consolidates a top-level
   `SHA256SUMS`, generates `RELEASE_NOTES.md` from commits/PRs since the previous tag,
   and creates the GitHub Release with all installers, the `latest*.yml` + `*.blockmap`
   auto-update metadata, the SBOM, and checksums attached.
3. Tags containing a hyphen (e.g. `v1.2.0-rc.1`) are published as **pre-releases**.

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
gh attestation verify limboo-<platform>.<ext> --repo BotCoder254/limboo
```

## 6. Optional GitLab mirror

If a GitLab mirror is configured, the tag also produces a GitLab Release via the
`release` stage in `.gitlab-ci.yml`.

## Rollback

Releases are immutable artifacts. To withdraw a bad release: mark the GitHub Release as a
draft or delete it, delete the tag (`git push --delete origin v1.2.0`), fix forward, and
cut a new patch tag. Never reuse a version number.
