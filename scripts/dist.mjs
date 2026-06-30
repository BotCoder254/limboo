#!/usr/bin/env node
/**
 * Hybrid packaging step: wrap the Forge-packaged app into branded installers.
 *
 * Electron Forge owns dev (`npm start`) and app packaging (`electron-forge
 * package` — applies the Vite build, the security fuses, and the asar/asar-unpack
 * layout). This script then runs electron-builder over that already-packaged
 * directory via `--prepackaged`, so electron-builder NEVER re-packs the app (the
 * fuses + asar-integrity Forge applied are preserved) and only produces the
 * branded NSIS / dmg / AppImage targets plus the `latest*.yml` auto-update
 * metadata that electron-updater consumes.
 *
 * Cross-platform on purpose: invoked as `node scripts/dist.mjs [extra args]` so it
 * works identically under bash/zsh and Windows cmd.exe in CI. Any extra args
 * (e.g. `--publish always`) are forwarded straight to electron-builder.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Forge names the packaged dir from packagerConfig.name ('Limboo') + platform/arch.
const prepackaged = resolve(
  process.cwd(),
  'out',
  `Limboo-${process.platform}-${process.arch}`,
);

if (!existsSync(prepackaged)) {
  console.error(
    `[dist] Expected Forge package output at "${prepackaged}" but it does not exist.\n` +
      `       Run "electron-forge package" first (npm run dist does this for you).`,
  );
  process.exit(1);
}

// Map the current platform to electron-builder's target flag so each CI runner
// builds only its own OS's installers (the release matrix covers all three).
const platformFlag =
  process.platform === 'win32' ? '--win' : process.platform === 'darwin' ? '--mac' : '--linux';

const args = ['electron-builder', platformFlag, '--prepackaged', prepackaged, ...process.argv.slice(2)];

console.log(`[dist] electron-builder ${args.slice(1).join(' ')}`);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32', // npx resolution on Windows needs the shell
});

process.exit(result.status ?? 1);
