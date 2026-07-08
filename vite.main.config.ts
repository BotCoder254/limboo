import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The Cursor bridge scripts (hook runner + stdio MCP bridge) are standalone,
// dependency-free CJS files that `cursor-agent` spawns as separate processes —
// they must ship as REAL files beside main.js (asar-unpacked in packaged
// builds; see forge.config.ts), never bundled into it.
const BRIDGE_SCRIPTS = ['hookRunner.cjs', 'mcpBridge.cjs'];
function copyCursorBridgeScripts(): Plugin {
  return {
    name: 'copy-cursor-bridge-scripts',
    writeBundle(options) {
      const outDir = options.dir ?? join('.vite', 'build');
      const srcDir = fileURLToPath(new URL('./src/main/managers/cursor/bridge', import.meta.url));
      for (const name of BRIDGE_SCRIPTS) {
        copyFileSync(join(srcDir, name), join(outDir, name));
      }
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [copyCursorBridgeScripts()],
  // Pin a distinct output filename. Forge's Vite plugin names every build
  // `[name].js` from the entry basename — both the main and preload entries are
  // `index.ts`, so without this they would both emit `index.js` and clobber each
  // other. This yields `.vite/build/main.js` (matches package.json `main`).
  build: {
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'main.js' },
    rollupOptions: {
      // Native modules must NOT be bundled: `better-sqlite3` (via `bindings`)
      // does a dynamic `require()` of its compiled `.node` binary, which Rollup
      // cannot trace. Externalizing it means the bundle keeps a plain runtime
      // `require('better-sqlite3')` that resolves from node_modules (unpacked
      // from the asar by AutoUnpackNatives in packaged builds).
      //
      // `@anthropic-ai/claude-agent-sdk` is ESM-only and spawns the Claude Code
      // runtime; it must stay external and be loaded via native dynamic import
      // (see AgentManager) rather than bundled into the CJS main entry.
      //
      // `node-pty` (pinned to the 1.2.0-beta Node-API line — see
      // TerminalManager.ts) is a native module: it `require()`s its compiled
      // `pty.node` / `conpty.node` binary, so it must stay external (kept as a
      // runtime `require`, resolved from node_modules, unpacked from the asar by
      // AutoUnpackNatives).
      // `electron-updater` does runtime `require()`s (its lazy provider loading +
      // native-ish behavior) that Rollup cannot trace, and it must resolve from
      // node_modules at runtime. Keep it external (plain runtime `require`) like
      // the native modules below.
      // `sherpa-onnx-node` (voice worker runtime) is a native Node-API addon —
      // external for the same reason as node-pty. `tar-fs` / `unbzip2-stream`
      // (voice model archive extraction) stay external too: plain runtime
      // `require()`s resolved from the pruned production node_modules.
      external: [
        'better-sqlite3',
        'bindings',
        '@anthropic-ai/claude-agent-sdk',
        'node-pty',
        'electron-updater',
        'sherpa-onnx-node',
        'tar-fs',
        'unbzip2-stream',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});
