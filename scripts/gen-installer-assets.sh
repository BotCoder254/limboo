#!/usr/bin/env bash
#
# Regenerate the branded Windows-installer art from the single source of truth,
# assets/icon.svg (the Limboo pink "blob" mark, fill #ff0066 on transparent).
#
# Mirrors the rsvg-convert workflow already documented in CLAUDE.md for the app
# icon. Everything the NSIS wizard shows is derived here so the installer reads as
# the same product as the app: pure-black (#000000) canvas, #ff0066 brand mark, the
# #ededed wordmark. Run after editing assets/icon.svg:
#
#   bash scripts/gen-installer-assets.sh
#
# Requires: rsvg-convert + ImageMagick (magick or convert).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets/icon.svg"
OUT="$ROOT/assets/installer"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Theme tokens (kept in lockstep with src/renderer/styles/index.css).
BLACK="#000000"
ACCENT="#6e9bff"
FG="#ededed"
MUTED="#9a9a9a"

# ImageMagick 7 ships `magick`; 6 ships `convert`.
if command -v magick >/dev/null 2>&1; then IM="magick"; else IM="convert"; fi

# ImageMagick font *aliases* (Helvetica, …) are unreliable across distros; resolve
# concrete .ttf files with fontconfig instead so the script works on any CI box.
FONT="$(fc-match -f '%{file}' 'sans-serif' 2>/dev/null || true)"
FONT_BOLD="$(fc-match -f '%{file}' 'sans-serif:bold' 2>/dev/null || echo "$FONT")"
[ -n "$FONT" ] || { echo "[assets] no sans-serif font found via fontconfig" >&2; exit 1; }

mkdir -p "$OUT"

echo "[assets] rasterizing brand mark from $SRC"
for s in 16 24 32 48 64 128 256 512; do
  rsvg-convert -w "$s" -h "$s" "$SRC" -o "$TMP/orbit-$s.png"
done

# --- Windows .ico (setup exe + installerIcon + installerHeaderIcon) ------------
echo "[assets] building icon.ico"
"$IM" "$TMP/orbit-16.png" "$TMP/orbit-24.png" "$TMP/orbit-32.png" \
      "$TMP/orbit-48.png" "$TMP/orbit-64.png" "$TMP/orbit-128.png" \
      "$TMP/orbit-256.png" "$OUT/icon.ico"

# --- Welcome/finish sidebar (164 x 314, BMP3, NSIS MUI_WELCOMEFINISHPAGE) ------
# Black canvas, orbit mark up top, brand wordmark + tagline below.
build_sidebar() {
  local dest="$1"
  echo "[assets] building $(basename "$dest")"
  "$IM" -size 164x314 "xc:$BLACK" \
    \( "$TMP/orbit-128.png" -resize 96x96 \) -gravity North -geometry +0+40 -composite \
    -gravity North -fill "$FG" -font "$FONT_BOLD" -pointsize 22 -annotate +0+152 "Limboo" \
    -gravity North -fill "$MUTED" -font "$FONT" -pointsize 10 -annotate +0+184 "AI software" \
    -gravity North -fill "$MUTED" -font "$FONT" -pointsize 10 -annotate +0+198 "development" \
    -gravity South -fill "$ACCENT" -font "$FONT" -pointsize 9 -annotate +0+18 "limboo" \
    "BMP3:$dest"
}
build_sidebar "$OUT/installerSidebar.bmp"
build_sidebar "$OUT/uninstallerSidebar.bmp"

# --- Header strip (150 x 57, BMP3, NSIS MUI_HEADERIMAGE) -----------------------
echo "[assets] building installerHeader.bmp"
"$IM" -size 150x57 "xc:$BLACK" \
  \( "$TMP/orbit-48.png" -resize 40x40 \) -gravity West -geometry +12+0 -composite \
  -gravity West -fill "$FG" -font "$FONT_BOLD" -pointsize 15 -annotate +60+0 "Limboo" \
  "BMP3:$OUT/installerHeader.bmp"

echo "[assets] done -> $OUT"
ls -la "$OUT"
