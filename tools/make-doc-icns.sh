#!/usr/bin/env bash
# Build eigendeck-doc.icns from the pre-rendered iconset. macOS only — uses the
# built-in `iconutil`, so NO Python / venv / brew needed on your Mac.
#
#   bash tools/make-doc-icns.sh
#
# The .iconset is pre-rendered and committed (the two-master composite:
# proxy art in the 16/32 pt slots, mark-on-Apple-page in 128 pt+). Regenerating
# the iconset from the SVG masters is the only step that needs the Python
# renderer (tools/build_doc_icon.py) — that runs on Linux/CI, not here. So your
# Mac loop is just this one command.
set -euo pipefail
cd "$(dirname "$0")/.."

ICONSET="src-tauri/icons/document/eigendeck-doc.iconset"
OUT="src-tauri/icons/document/eigendeck-doc.icns"

if ! command -v iconutil >/dev/null 2>&1; then
  echo "error: iconutil not found (this script is macOS-only)." >&2
  exit 1
fi
if [ ! -d "$ICONSET" ]; then
  echo "error: missing $ICONSET" >&2
  exit 1
fi

iconutil -c icns "$ICONSET" -o "$OUT"
echo "wrote $OUT"
