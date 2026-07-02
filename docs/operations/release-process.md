# Release process

This page is for maintainers cutting a release. Limboo is packaged with Electron
Forge; releases are driven from the `main` branch.

## Prerequisites

- A clean `main` with all intended changes merged and verified.
- `npm run lint` and `npx vite build --config vite.renderer.config.mts` pass.
- The app starts and smoke-tests via `npm start`.

## Steps

1. **Decide the version.** Follow [versioning](versioning.md) (SemVer). Update the
   `version` field in `package.json`.
2. **Update the changelog.** Move the `Unreleased` items in
   [CHANGELOG.md](../../CHANGELOG.md) into a new version section with the date, and
   refresh the compare links.
3. **Commit and tag.** Commit the version and changelog, then tag `vX.Y.Z` and
   `git push origin vX.Y.Z` (fans out to GitLab — the source of truth — and the
   GitHub mirror). The tag triggers the GitLab release pipeline.
4. **Build artifacts.**
   ```bash
   npm run package   # runnable bundle (no installers)
   npm run dist      # branded installers + auto-update metadata into dist/
   ```
   `npm run dist` runs `electron-forge package` then electron-builder
   (`--prepackaged`) to produce the branded NSIS / dmg / AppImage installers and the
   `latest*.yml` auto-update metadata. See
   [installer and updates](installer-and-updates.md) and
   [packaging and signing](packaging-and-signing.md).
5. **Publish.** The GitLab pipeline publishes automatically on a `v*` tag — an
   identical GitLab Release and GitHub Release (see
   [release-process](../ci/release-process.md)). For a manual fallback use
   `npm run dist:publish` (with `GH_TOKEN` set) or attach `dist/*` — installers,
   `latest*.yml`, and `*.blockmap` — to the GitHub release with the `gh` CLI.
6. **Verify the release.** Download an artifact from both hosts and confirm it
   launches.

## Release checklist

- [ ] `main` is green (CI passed).
- [ ] `package.json` version bumped.
- [ ] `CHANGELOG.md` updated with date and compare links.
- [ ] Tag `vX.Y.Z` created.
- [ ] Artifacts built (`npm run dist`) and smoke-tested.
- [ ] GitLab + GitHub releases published with notes and artifacts.

## Notes

- Code signing and notarization are not yet configured, so installers are unsigned;
  see [packaging and signing](packaging-and-signing.md).
- There is no separate backend or cloud component to deploy — Limboo is local-first.
