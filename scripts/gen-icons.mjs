#!/usr/bin/env node
/**
 * Rasterize the app icon PNGs the main process loads at runtime, from the single
 * source of truth: assets/icon.svg (the Limboo pink blob mark).
 *
 * Cross-platform (uses `sharp`, which ships prebuilt binaries), so it works on the
 * Windows dev box where rsvg-convert / ImageMagick are unavailable. It only
 * produces the runtime app/tray/notification icons — the Windows *installer* art
 * (.ico, NSIS sidebars) is still built by scripts/gen-installer-assets.sh, which
 * needs rsvg-convert + ImageMagick.
 *
 *   node scripts/gen-icons.mjs
 *
 * Outputs:
 *   assets/icon.png       512x512  (window + notification icon)
 *   assets/icon@256.png   256x256  (hi-dpi variant)
 *   assets/tray.png        32x32   (system tray)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

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

console.log('[icons] done');
