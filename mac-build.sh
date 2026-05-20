#!/bin/bash
# Build and run Eigendeck in Tauri dev mode on macOS.
# Re-runs npm install to get macOS-native binaries (safe if Linux overwrote them).
#
# Pass --debug to enable the Debug menu:
#   bash mac-build.sh --debug
#
# (We translate --debug to EIGENDECK_DEBUG=1 because Tauri's `tauri dev`
# argv passthrough places extra args BEFORE cargo's `--` separator, so a
# bare --debug reaches cargo and errors out instead of the app binary. The
# released binary still accepts --debug on argv directly.)

set -e
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"

if [ "${1:-}" = "--debug" ]; then
  export EIGENDECK_DEBUG=1
  shift
fi

npm install

if [ $# -gt 0 ]; then
  npm run tauri dev -- -- "$@"
else
  npm run tauri dev
fi
