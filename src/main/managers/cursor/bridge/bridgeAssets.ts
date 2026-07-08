/**
 * Runtime path resolution for the standalone bridge scripts
 * (hookRunner.cjs / mcpBridge.cjs). They are emitted BESIDE main.js by the
 * main Vite build (see vite.main.config.ts) and unpacked from the asar in
 * packaged builds (electron-builder `asarUnpack`) so `cursor-agent` can spawn
 * them from a real on-disk path — the same constraint as the Claude SDK
 * binary (an asar-internal path is not executable).
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const ASAR_SEG = `${path.sep}app.asar${path.sep}`;
const UNPACKED_SEG = `${path.sep}app.asar.unpacked${path.sep}`;

export type BridgeScript = 'hookRunner.cjs' | 'mcpBridge.cjs';

/** Absolute on-disk path of a bridge script, or null when unresolvable. */
export function bridgeScriptPath(name: BridgeScript): string | null {
  const candidates = [
    // Packaged / dev build output: the script is emitted beside main.js.
    path.join(__dirname, name).replace(ASAR_SEG, UNPACKED_SEG),
    // Dev fallback: resolve straight from the source tree.
    path.join(app.getAppPath(), 'src', 'main', 'managers', 'cursor', 'bridge', name),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * The command used to execute a bridge script: Electron-as-node. Works in dev
 * and packaged builds without relying on a system Node install; the
 * ELECTRON_RUN_AS_NODE env var must accompany it in whatever config or spawn
 * uses this command.
 */
export function bridgeNodeCommand(): string {
  return process.execPath;
}
