# Dependency updates

Limboo's dependencies are coupled to a specific toolchain. Updating them carelessly
breaks the build, so this page documents the constraints.

## The pinned core

- **Electron 42** and **Vite 5** are pinned and bumped **deliberately**, never via
  automated PRs. Dependabot is configured to ignore them
  ([`.github/dependabot.yml`](../../.github/dependabot.yml)).
- `@vitejs/plugin-react` is on the **v4** line on purpose. v6 requires Vite 8, but
  Electron Forge's Vite plugin pins Vite 5; installing v6 breaks peer resolution.
- Tailwind v4 is CSS-first (no config files). The Vite plugin
  (`@tailwindcss/vite`) is ESM-only, which is why the renderer Vite config is `.mts`.
- TypeScript is intentionally old (`~4.5`); the renderer is transpiled by esbuild via
  Vite, not `tsc`.

When bumping Vite, re-check the `@vitejs/plugin-react` and `@tailwindcss/vite`
compatibility, and that the `.mts` ESM loading still holds.

## Native modules

`better-sqlite3` is a compiled native module. After a Node major upgrade,
reinstall so it rebuilds against the new ABI; if a build fails, confirm the
C/C++ toolchain is present and remove `node_modules` before reinstalling.
`node-pty` (pinned to the Node-API `1.2.0-beta` line) does not need this —
its prebuilt is ABI-stable across Node.js and Electron versions, and it's
excluded from Electron Forge's rebuild pass (`forge.config.ts`
`rebuildConfig.ignoreModules`). See [installation](../getting-started/installation.md).

## Process for a dependency PR

1. Read the changelog of the bumped package for breaking changes.
2. Install and watch for peer-dependency warnings (especially anything touching
   Vite).
3. Verify: `npm run lint` and
   `npx vite build --config vite.renderer.config.mts`, then `npm start` for a smoke
   test (native modules and IPC).
4. For Electron / Vite, additionally confirm the packaged build with
   `npm run package`.

## Automation

Dependabot opens weekly grouped PRs for npm (production and development separately)
and for GitHub Actions. CodeQL runs on a schedule for static analysis. See
[CI/CD](ci-cd.md).
