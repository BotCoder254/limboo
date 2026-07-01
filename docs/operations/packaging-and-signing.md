# Packaging and signing

Limboo is packaged with Electron Forge. This page covers building distributable
artifacts and the current state of code signing.

## Commands

```bash
npm run package   # package into a runnable app bundle (no installers)
npm run make      # build platform installers
npm run publish   # publish (configured via forge.config.ts)
```

## Makers

`npm run make` produces installers via Electron Forge makers configured in
[`forge.config.ts`](../../forge.config.ts):

| Platform | Maker |
| -------- | ----- |
| Windows  | Squirrel |
| macOS    | ZIP |
| Linux    | deb, rpm |

## Native modules

Two dependencies are native modules: `better-sqlite3`, built per target platform
/ Node ABI, and `node-pty` (pinned to the Node-API `1.2.0-beta` line), whose
bundled prebuilt is ABI-stable and ships as-is — it's excluded from Electron
Forge's native-rebuild pass (`forge.config.ts` `rebuildConfig.ignoreModules`).
The Forge `auto-unpack-natives` plugin keeps both runnable from the packaged
app. Build on (or for) each target platform; cross-building native modules is
not configured.

## Build-output naming

Both process entries are `index.ts`; their bundle names are pinned in the Vite
configs (`main.js` via `build.lib.fileName`, `preload.js` via
`rollupOptions.output.entryFileNames`) so they do not collide on `index.js`. These
must match `package.json` `main` and the `preload.js` path in `createWindow.ts`. Do
not introduce an entry that collides on basename. See [`CLAUDE.md`](../../CLAUDE.md)
§6.

## Fuses

Electron fuses are configured via `@electron-forge/plugin-fuses` /
`@electron/fuses` in the Forge config; review them when changing the security posture
of the packaged binary.

## Code signing and notarization (Planned)

Signing and notarization are **not yet configured**, so produced installers are
unsigned and users will see the usual OS warnings. Adding them requires:

- macOS: an Apple Developer ID certificate and notarization credentials.
- Windows: an Authenticode certificate.

Until then, distribute with a clear note that artifacts are unsigned. See
[ROADMAP.md](../../ROADMAP.md).
