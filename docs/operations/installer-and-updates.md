# Branded installer and auto-update

Limboo treats installation as the first screen of the app: a branded, multi-page
Windows installer that reuses the app's pure-black (`#000000`) theme and the
`#ff0066` pink blob brand mark, plus in-app auto-update. This document explains the
hybrid build flow, how to regenerate the installer art, and how releases
authenticate.

## Hybrid build flow (Forge + electron-builder)

Electron Forge stays the primary tool: it drives `npm start` (Vite HMR) and
`electron-forge package`, which applies the Vite build, the security **fuses**, and
the **asar / asar-unpack** layout. electron-builder runs as a second step over that
already-packaged directory (`--prepackaged`), so it never re-packs the app — the
fuses and asar-integrity Forge baked in are preserved — and only produces the
branded installers plus the `latest*.yml` auto-update metadata.

```
npm start            electron-forge start                       # dev (HMR)
npm run package      electron-forge package                     # -> out/Limboo-<plat>-<arch>/
npm run dist         package + node scripts/dist.mjs            # -> dist/ (installers + latest*.yml)
npm run dist:publish package + node scripts/dist.mjs --publish always
```

`scripts/dist.mjs` resolves the Forge output dir, maps the current OS to the
electron-builder target flag (`--win` / `--mac` / `--linux`), and forwards any
extra args (e.g. `--publish never`). It is cross-platform (works under Windows
cmd.exe in CI).

Targets (see `electron-builder.yml`):

- **Windows** — branded NSIS wizard (`*-Setup-*.exe`).
- **macOS** — `dmg` + `zip` (zip is required for electron-updater self-update).
- **Linux** — `AppImage` (required for self-update) + `deb` + `rpm`.

## Regenerating the installer art

All NSIS art derives from `assets/icon.svg`. After editing the SVG, regenerate:

```bash
npm run gen:installer   # cross-platform Node (sharp + resvg + opentype.js)
```

The generator ([`scripts/gen-installer-assets.mjs`](../../scripts/gen-installer-assets.mjs))
works on Windows/macOS/Linux with no system tools: wordmark text is outlined into
SVG paths from the vendored Inter TTFs (`assets/installer/fonts/`, SIL OFL), so the
output is byte-deterministic on any machine. Outputs to `assets/installer/`:
`icon.ico` (multi-res 16→256), `installerSidebar.bmp` and `uninstallerSidebar.bmp`
(164×314, BMP3), and `installerHeader.bmp` (150×57, BMP3) — pure-black canvas,
`#ff0066` brand mark, `#ededed` wordmark, `#9a9a9a` tagline.
`assets/installer/installer.nsh` layers on brand identity (finish-page text, brand
registry key) and is referenced from the `nsis.include` option.

The NSIS wizard is configured for a guided experience: license page, custom install
directory, desktop + Start Menu shortcuts, run-after-finish, and — importantly —
`deleteAppDataOnUninstall: false`, so uninstalling **never** wipes the user's
workspaces, `limboo.db`, memories, logs, or terminal history.

## Auto-update

`AutoUpdateManager` (`src/main/managers/AutoUpdateManager.ts`) wraps
`electron-updater`. It configures the GitHub feed programmatically and reads the
`latest*.yml` published to GitHub Releases. It is active **only** in a packaged
build (and only the AppImage on Linux); it is a no-op in dev. Status flows to the
renderer over the `update:status` IPC event and surfaces as the `UpdateBanner` plus
the **Settings → Updates** panel (auto-check / auto-download toggles + "Check now").
The feed is HTTPS and host-fixed (no renderer-supplied URLs), and the downloaded
installer is signature-verified before it is applied — no update credentials are
ever stored.

## Release authentication: GH_TOKEN vs the `gh` CLI

- **Automated CI releases** use **`GH_TOKEN`**. On CircleCI (the primary
  publisher — the `release` workflow in `.circleci/config.yml`), store a
  fine-grained PAT with `contents:write` as `GH_TOKEN` in the `limboo-release`
  **Context** (never in the config file); the `publish-release` job feeds it to a
  pinned `gh` CLI. On the GitHub Actions fallback (`release.yml`, manual
  dispatch), the built-in `GITHUB_TOKEN` (with `contents: write`) is sufficient
  via `softprops/action-gh-release`.
- **Manual / local releases** use your authenticated **`gh` CLI**:

  ```bash
  npm run dist                     # build installers locally into dist/
  gh release create v1.2.3 \
    --title "Limboo v1.2.3" --notes-file RELEASE_NOTES.md \
    dist/*.exe dist/*.dmg dist/*.AppImage dist/*.deb dist/*.rpm dist/*.zip \
    dist/latest*.yml dist/*.blockmap
  ```

  The `latest*.yml` and `*.blockmap` files **must** be attached or auto-update will
  not detect/verify new versions.

CI never uses the local `gh` login; it always uses the token from the secret/context.

## Deploy markers (CircleCI)

The CircleCI `release` job logs a deploy marker so the release shows up in the
Deploys UI and can drive rollback/deploy pipelines (auto-generated markers were
sunset 2025-06, so they are created explicitly):

```
circleci run release plan "limboo-$CIRCLE_TAG" --environment-name=production \
  --component-name=limboo-desktop --target-version="$CIRCLE_TAG" --namespace=default
circleci run release update "limboo-$CIRCLE_TAG" --status=running
# ... publish ...
circleci run release update "limboo-$CIRCLE_TAG" --status=SUCCESS    # or FAILED on_fail
```
