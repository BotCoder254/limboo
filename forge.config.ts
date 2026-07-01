import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    // Unpack the Claude Agent SDK from the asar: it is ESM-only, is loaded via a
    // native dynamic import in the main process, and extracts/spawns its bundled
    // Claude Code runtime — none of which work from inside an asar archive.
    asar: {
      unpack: '**/node_modules/@anthropic-ai/**',
    },
    name: 'Limboo',
    icon: 'assets/icon',
    // @electron-forge/plugin-vite installs a default `packagerConfig.ignore` that
    // keeps ONLY the `.vite` build output and excludes everything else —
    // including `node_modules` and `assets/`. That assumes the entire app is
    // bundled by Vite, which isn't true here: vite.main.config.ts intentionally
    // keeps native/runtime-only deps (better-sqlite3, bindings, node-pty,
    // electron-updater, @anthropic-ai/claude-agent-sdk) external as plain
    // `require()` calls that must resolve from `node_modules` at runtime, and
    // `assetPath()` (src/main/paths.ts) reads icons from `assets/` at runtime via
    // `app.getAppPath()`. Without this override, the packaged app has no
    // node_modules at all and crashes on the first externalized `require()`
    // before any logging happens.
    //
    // Supplying our own `ignore` function here makes the Vite plugin skip its
    // default (it only warns that the app may be larger than expected — expected,
    // since we now intentionally keep node_modules). Production dependencies are
    // still pruned down from the full node_modules by the packager's default
    // `prune: true` behavior, which walks the real dependency graph and drops
    // devDependencies (so transitive deps like `bindings` are kept automatically
    // without needing to be listed here).
    ignore: (file) => {
      if (!file) return false;
      // `file` always starts with `/`. Replicate electron-packager's
      // DEFAULT_IGNORES (lockfiles, .git, node_modules/.bin, native build
      // artifacts) — these are skipped entirely once a custom `ignore` function
      // is supplied.
      if (
        /\/package-lock\.json$/.test(file) ||
        /\/yarn\.lock$/.test(file) ||
        /\/pnpm-lock\.yaml$/.test(file) ||
        /\/\.git($|\/)/.test(file) ||
        /\/node_modules\/\.bin($|\/)/.test(file) ||
        /\.o(bj)?$/.test(file) ||
        /\/node_gyp_bins($|\/)/.test(file)
      ) {
        return true;
      }
      // Keep: Vite's build output, the root package.json (required by the Vite
      // plugin), bundled static assets, and node_modules (pruned to production
      // deps above). Ignore everything else (source, configs, dev-only files).
      const keep =
        file.startsWith('/.vite') ||
        file === '/package.json' ||
        file.startsWith('/assets') ||
        file.startsWith('/node_modules');
      return !keep;
    },
  },
  // `node-pty` (pinned to the 1.2.0-beta Node-API line) ships its own
  // ABI-stable per-platform prebuilt and resolves it at runtime without ever
  // needing a `node-gyp` rebuild (see TerminalManager.ts). `@electron/rebuild`
  // doesn't know that — left alone it tries to recompile every native module
  // for Electron's ABI on every `start`/`package`/`make`, which fails on a
  // machine with no Visual Studio Build Tools installed. Excluding it here is
  // what actually avoids that requirement; better-sqlite3 (the only other
  // native dep) still rebuilds normally.
  rebuildConfig: { ignoreModules: ['node-pty'] },
  // No Forge makers: distributables are produced by electron-builder over the
  // Forge-packaged app dir (`npm run dist` -> scripts/dist.mjs), which is the only
  // path that supports the branded NSIS wizard + auto-update metadata + publishing.
  // Forge still owns dev (`npm start`) and app packaging (`electron-forge package`).
  makers: [],
  plugins: [
    // Unpack native modules (better-sqlite3) out of the asar so they can load.
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
