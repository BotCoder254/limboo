/**
 * Shared helper: write `resources/app-update.yml` into a packaged Limboo app dir.
 *
 * electron-updater reads `<resources>/app-update.yml` on every checkForUpdates()
 * to learn its feed + cache dir. electron-builder normally writes this file during
 * its own app-packaging step — but Limboo's hybrid flow never uses that step:
 * Electron Forge packages the app, and electron-builder only runs `--prepackaged`
 * (installers only, no re-pack). So the file is emitted by neither tool and must
 * be written manually.
 *
 * This helper is the single source of truth for that file. It is called from BOTH:
 *  - `forge.config.ts` `hooks.postPackage` — so EVERY Forge-packaged output has it
 *    (covers `npm run package`, running from `out/`, and the base of `npm run dist`).
 *  - `scripts/dist.mjs` — a redundant safety net before electron-builder wraps it.
 *
 * Content mirrors electron-builder's own output, derived from the `publish` block
 * in electron-builder.yml.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_UPDATE_YML =
  'owner: BotCoder254\n' +
  'provider: github\n' +
  'repo: limboo\n' +
  'updaterCacheDirName: limboo-updater\n';

/**
 * Resolve the `resources` dir inside a packaged app directory.
 * Resources live directly under the packaged dir on win/linux, but inside the
 * `.app` bundle on macOS.
 *
 * @param {string} appDir  packaged app directory (e.g. out/Limboo-win32-x64)
 * @param {NodeJS.Platform} platform  target platform (win32 | darwin | linux)
 * @returns {string}
 */
export function resourcesDirFor(appDir, platform) {
  return platform === 'darwin'
    ? join(appDir, 'Limboo.app', 'Contents', 'Resources')
    : join(appDir, 'resources');
}

/**
 * Write `app-update.yml` into the packaged app's resources dir.
 *
 * @param {string} appDir  packaged app directory (e.g. out/Limboo-win32-x64)
 * @param {NodeJS.Platform} platform  target platform (win32 | darwin | linux)
 * @returns {string}  the path written
 */
export function writeAppUpdateYml(appDir, platform) {
  const target = join(resourcesDirFor(appDir, platform), 'app-update.yml');
  writeFileSync(target, APP_UPDATE_YML, 'utf8');
  return target;
}
