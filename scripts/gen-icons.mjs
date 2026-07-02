#!/usr/bin/env node
/**
 * Rasterize the app icon PNGs the main process loads at runtime, from the single
 * source of truth: assets/icon.svg (the Limboo pink blob mark).
 *
 * Cross-platform (uses `sharp`, which ships prebuilt binaries), so it works on the
 * Windows dev box where rsvg-convert / ImageMagick are unavailable. It only
 * produces the runtime app/tray/notification icons — the Windows *installer* art
 * (.ico, NSIS sidebars) is built by the equally cross-platform
 * scripts/gen-installer-assets.mjs (`npm run gen:installer`).
 *
 *   node scripts/gen-icons.mjs
 *
 * Outputs:
 *   assets/icon.png       512x512  (window + notification icon)
 *   assets/icon@256.png   256x256  (hi-dpi variant)
 *   assets/tray.png        32x32   (system tray)
 *   assets/icon.ico       multi-res (16→256) — the WINDOWS APP/EXE icon.
 *                          Forge's `packagerConfig.icon: 'assets/icon'` needs
 *                          this .ico to embed into Limboo.exe (rcedit); without
 *                          it the exe/taskbar/desktop shortcut fall back to the
 *                          default Electron logo.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets', 'icon.svg');

const TARGETS = [
  { file: 'icon.png', size: 512 },
  { file: 'icon@256.png', size: 256 },
  { file: 'tray.png', size: 32 },
];

const svg = await readFile(SRC);

for (const { file, size } of TARGETS) {
  const out = path.join(ROOT, 'assets', file);
  // density scales the SVG rasterization so small sizes stay crisp.
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`[icons] wrote ${file} (${size}x${size})`);
}

// Multi-resolution Windows .ico for the app/exe icon. Rasterize the SVG at each
// standard size, then pack the PNG buffers into a single .ico via png-to-ico
// (same dependency the installer-art generator uses).
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(
  ICO_SIZES.map((size) =>
    sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ),
);
const ico = await pngToIco(icoPngs);
await writeFile(path.join(ROOT, 'assets', 'icon.ico'), ico);
console.log(`[icons] wrote icon.ico (${ICO_SIZES.join('/')})`);

console.log('[icons] done');
