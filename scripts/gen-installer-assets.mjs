#!/usr/bin/env node
/**
 * Regenerate the branded Windows-installer art from the single source of truth,
 * assets/icon.svg (the Limboo pink "blob" mark, fill #ff0066 on transparent).
 *
 * Cross-platform replacement for the old gen-installer-assets.sh: everything is
 * pure Node — `sharp` rasterizes composed SVGs (same as scripts/gen-icons.mjs),
 * `opentype.js` outlines the wordmark text into SVG paths from the vendored Inter
 * TTFs (assets/installer/fonts/, SIL OFL) so rendering is deterministic on any
 * machine (no fontconfig / ImageMagick / rsvg-convert), a hand-rolled 24-bit
 * writer emits the BMP3 files NSIS requires, and `png-to-ico` builds the
 * multi-resolution icon. Run after editing assets/icon.svg:
 *
 *   npm run gen:installer
 *
 * Outputs (assets/installer/):
 *   icon.ico                16/24/32/48/64/128/256 (setup exe + installer icons)
 *   installerSidebar.bmp    164x314 BMP3 (NSIS MUI_WELCOMEFINISHPAGE)
 *   uninstallerSidebar.bmp  164x314 BMP3 (uninstall wizard)
 *   installerHeader.bmp     150x57  BMP3 (NSIS MUI_HEADERIMAGE)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
// Pinned to the 1.x line: opentype.js 2.0.0 mis-parses some Inter glyf outlines
// (glyphs render corrupted) and its shaper rejects Inter's GSUB lookups.
import opentype from 'opentype.js';
// resvg renders the composed SVGs deterministically (sharp's bundled SVG loader
// stays in use only for plain resizes, matching scripts/gen-icons.mjs).
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets', 'icon.svg');
const OUT = path.join(ROOT, 'assets', 'installer');
const FONTS = path.join(OUT, 'fonts');

// Theme tokens (kept in lockstep with src/renderer/styles/index.css @theme).
const BLACK = '#000000'; // --color-base
const BRAND = '#ff0066'; // --color-brand (the blob mark + footer wordmark)
const FG = '#ededed'; //    --color-fg    (heading wordmark)
const MUTED = '#9a9a9a'; // --color-muted (tagline)

// --- Load sources ---------------------------------------------------------------

const iconSvg = await readFile(SRC, 'utf8');
const blobPath = iconSvg.match(/\sd="([^"]+)"/)?.[1];
if (!blobPath) {
  console.error('[assets] could not find the blob <path d> in assets/icon.svg');
  process.exit(1);
}

async function loadFont(file) {
  const buf = await readFile(path.join(FONTS, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const regular = await loadFont('Inter-Regular.ttf');
const semiBold = await loadFont('Inter-SemiBold.ttf');

// --- SVG fragment builders --------------------------------------------------------

/** The blob mark, scaled into a size×size box at (x, y). icon.svg is a 200×200
 *  viewBox with the path centered via translate(100 100). */
function mark(x, y, size) {
  const s = size / 200;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<path fill="${BRAND}" d="${blobPath}" transform="translate(100 100)"/>` +
    `</g>`
  );
}

/** Text outlined to a path (deterministic — no font resolution at raster time).
 *  Glyphs are laid out one-by-one (charToGlyph + kerning) instead of
 *  font.getPath(): opentype.js's full shaping path trips over Inter's GSUB
 *  lookups it doesn't support, and these ASCII wordmarks don't need shaping.
 *  x is the left edge, or the center when align is 'center'; y is the baseline. */
function text(font, str, size, x, y, fill, align = 'left') {
  const scale = size / font.unitsPerEm;
  const glyphs = [...str].map((ch) => font.charToGlyph(ch));
  let width = 0;
  glyphs.forEach((g, i) => {
    if (i > 0) width += font.getKerningValue(glyphs[i - 1], g) * scale;
    width += g.advanceWidth * scale;
  });
  let cx = align === 'center' ? x - width / 2 : x;
  let d = '';
  glyphs.forEach((g, i) => {
    if (i > 0) cx += font.getKerningValue(glyphs[i - 1], g) * scale;
    d += g.getPath(cx, y, size).toPathData(2);
    cx += g.advanceWidth * scale;
  });
  return `<path fill="${fill}" d="${d}"/>`;
}

function svgDoc(w, h, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${BLACK}"/>${body}</svg>`
  );
}

// Welcome/finish sidebar (164×314): mark up top, wordmark + tagline below, small
// brand-pink wordmark at the foot. Geometry mirrors the retired ImageMagick script.
const SIDEBAR = svgDoc(
  164,
  314,
  mark((164 - 96) / 2, 40, 96) +
    text(semiBold, 'Limboo', 22, 82, 174, FG, 'center') +
    text(regular, 'AI software', 10, 82, 194, MUTED, 'center') +
    text(regular, 'development', 10, 82, 208, MUTED, 'center') +
    text(regular, 'limboo', 9, 82, 296, BRAND, 'center'),
);

// Header strip (150×57): small mark + wordmark, vertically centered.
const HEADER = svgDoc(
  150,
  57,
  mark(12, 8.5, 40) + text(semiBold, 'Limboo', 15, 60, 34, FG),
);

// --- Rasterization ----------------------------------------------------------------

/** Render an SVG at 4× (supersampled, then downscaled for clean antialiasing),
 *  then encode as a bottom-up 24-bit BI_RGB BMP ("BMP3") — the only flavor NSIS
 *  reliably displays (no alpha, no V4/V5 header). */
async function svgToBmp(svg, width, height) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width * 4 } }).render().asPng();
  const { data, info } = await sharp(png)
    .resize(width, height)
    .flatten({ background: BLACK })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowSize = Math.ceil((width * 3) / 4) * 4; // rows pad to 4-byte boundaries
  const offset = 14 + 40; // BITMAPFILEHEADER + BITMAPINFOHEADER
  const buf = Buffer.alloc(offset + rowSize * height);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(40, 14); // BITMAPINFOHEADER size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive height = bottom-up rows
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // BI_RGB (uncompressed)
  buf.writeUInt32LE(rowSize * height, 34);
  buf.writeInt32LE(2835, 38); // 72 DPI in pixels/metre
  buf.writeInt32LE(2835, 42);
  for (let row = 0; row < height; row++) {
    const src = (height - 1 - row) * width * info.channels;
    const dst = offset + row * rowSize;
    for (let x = 0; x < width; x++) {
      buf[dst + x * 3] = data[src + x * info.channels + 2]; // B
      buf[dst + x * 3 + 1] = data[src + x * info.channels + 1]; // G
      buf[dst + x * 3 + 2] = data[src + x * info.channels]; // R
    }
  }
  return buf;
}

console.log(`[assets] rasterizing brand mark from ${path.relative(ROOT, SRC)}`);

// --- icon.ico (setup exe + installerIcon + installerHeaderIcon) --------------------
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(
  icoSizes.map((s) =>
    sharp(Buffer.from(iconSvg), { density: 384 })
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ),
);
await writeFile(path.join(OUT, 'icon.ico'), await pngToIco(icoPngs));
console.log('[assets] wrote icon.ico');

// --- NSIS bitmaps -------------------------------------------------------------------
const sidebar = await svgToBmp(SIDEBAR, 164, 314);
await writeFile(path.join(OUT, 'installerSidebar.bmp'), sidebar);
console.log('[assets] wrote installerSidebar.bmp (164x314)');
await writeFile(path.join(OUT, 'uninstallerSidebar.bmp'), sidebar);
console.log('[assets] wrote uninstallerSidebar.bmp (164x314)');
await writeFile(path.join(OUT, 'installerHeader.bmp'), await svgToBmp(HEADER, 150, 57));
console.log('[assets] wrote installerHeader.bmp (150x57)');

console.log(`[assets] done -> ${path.relative(ROOT, OUT)}`);
