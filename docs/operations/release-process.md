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
3. **Commit and tag.** Commit the version and changelog, then tag `vX.Y.Z`.
4. **Build artifacts.**
   ```bash
   npm run package   # runnable bundle (no installers)
   npm run make      # platform installers (deb / rpm / zip / squirrel)
   ```
   See [packaging and signing](packaging-and-signing.md).
5. **Publish.** `npm run publish` is configured via `forge.config.ts`. Attach the
   built artifacts to the GitHub release for the tag.
6. **Verify the release.** Download an artifact and confirm it launches.

## Release checklist

- [ ] `main` is green (CI passed).
- [ ] `package.json` version bumped.
- [ ] `CHANGELOG.md` updated with date and compare links.
- [ ] Tag `vX.Y.Z` created.
- [ ] Artifacts built (`npm run make`) and smoke-tested.
- [ ] GitHub release published with notes and artifacts.

## Notes

- Code signing and notarization are not yet configured, so installers are unsigned;
  see [packaging and signing](packaging-and-signing.md).
- There is no separate backend or cloud component to deploy — Limboo is local-first.
