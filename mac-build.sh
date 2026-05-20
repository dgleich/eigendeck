#!/bin/bash
# Build and run Eigendeck in Tauri dev mode on macOS.
# Re-runs npm install to get macOS-native binaries (safe if Linux overwrote them).
#
# Any args are forwarded to the Tauri app binary, e.g.:
#   bash mac-build.sh --debug    # enables the Debug menu

set -e
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"
npm install
if [ $# -gt 0 ]; then
  # npm passes "$@" after the first --; tauri dev passes args after the second
  # -- through to the built app.
  npm run tauri dev -- -- "$@"
else
  npm run tauri dev
fi
