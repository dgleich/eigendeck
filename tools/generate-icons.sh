#!/bin/bash
# Generate Tauri app icons from the logo SVG.
# Run on macOS (requires rsvg-convert from librsvg: brew install librsvg)
#
# Usage: bash tools/generate-icons.sh

set -e
cd "$(dirname "$0")/.."

SVG="logo-icon-light.svg"
OUT="/tmp/eigendeck-icon-1024.png"

# Render SVG to 1024x1024 PNG with padding
if command -v rsvg-convert &>/dev/null; then
  echo "Rendering SVG to PNG via rsvg-convert..."
  rsvg-convert -w 1024 -h 1024 --background-color=transparent "$SVG" -o "$OUT"
elif command -v inkscape &>/dev/null; then
  echo "Rendering SVG to PNG via Inkscape..."
  inkscape "$SVG" --export-type=png --export-filename="$OUT" -w 1024 -h 1024
elif command -v magick &>/dev/null; then
  echo "Rendering SVG to PNG via ImageMagick..."
  magick -background none -resize 1024x1024 "$SVG" "$OUT"
else
  echo "Error: Need rsvg-convert, inkscape, or imagemagick"
  echo "  brew install librsvg"
  exit 1
fi

echo "Generated $OUT"

# Use Tauri's icon generator to create all sizes
echo "Generating Tauri icons..."
npx tauri icon "$OUT"

echo "Done! Icons are in src-tauri/icons/"
