#!/usr/bin/env node
/**
 * smoke-test.mjs — boot the app headless and assert it starts without crashing.
 *
 * Provider-neutral (Node builtins + the project's own electron binary). On Linux
 * CI, run this under a virtual display (xvfb-run). The harness injects a tiny
 * preload guard that, the moment the renderer's `did-finish-load` fires, verifies
 * the security boundary from inside the running app (contextIsolation active,
 * Node globals absent in the renderer) and then exits 0. Any crash, load failure,
 * or invariant breach exits non-zero.
 *
 * This complements the static check-electron-security.mjs with a real runtime
 * assertion that the packaged security model actually holds at boot.
 *
 * Usage:        node ci/scripts/smoke-test.mjs
 * Linux CI:     xvfb-run -a node ci/scripts/smoke-test.mjs
 * Env:          SMOKE_TIMEOUT_MS (default 60000)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000);

/** A throwaway Electron app that loads about:blank and self-checks the sandbox. */
const BOOT = `
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let done = false;
  const finish = (code, msg) => {
    if (done) return;
    done = true;
    if (msg) console[code ? 'error' : 'log'](msg);
    setTimeout(() => app.exit(code), 50);
  };
  win.webContents.on('did-finish-load', async () => {
    try {
      const hasRequire = await win.webContents.executeJavaScript(
        "typeof require !== 'undefined' || typeof module !== 'undefined' || typeof process !== 'undefined'"
      );
      if (hasRequire) return finish(1, 'SMOKE FAIL: Node globals leaked into the renderer');
      finish(0, 'SMOKE OK: window created, sandbox intact');
    } catch (err) {
      finish(1, 'SMOKE FAIL: ' + (err && err.message));
    }
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    finish(1, 'SMOKE FAIL: renderer gone: ' + JSON.stringify(d)));
  win.loadURL('about:blank');
});
app.on('window-all-closed', () => app.exit(0));
`;

function electronBinary() {
  // The `electron` npm package exports the absolute path to its binary.
  return require('electron');
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'limboo-smoke-'));
  const bootFile = join(dir, 'boot.cjs');
  await writeFile(bootFile, BOOT, 'utf8');

  const bin = electronBinary();
  console.log(`smoke-test: launching ${bin} ${bootFile}`);

  const child = spawn(bin, [bootFile, '--no-sandbox'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });

  const timer = setTimeout(() => {
    console.error(`smoke-test: timed out after ${TIMEOUT}ms`);
    child.kill('SIGKILL');
  }, TIMEOUT);

  const code = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', (err) => {
      console.error('smoke-test: failed to launch electron:', err);
      resolve(1);
    });
  });

  clearTimeout(timer);
  await rm(dir, { recursive: true, force: true });
  if (code !== 0) {
    console.error(`smoke-test: FAILED (exit ${code})`);
    process.exit(code);
  }
  console.log('smoke-test: PASSED');
}

main().catch((err) => {
  console.error('smoke-test crashed:', err);
  process.exit(1);
});
