#!/bin/bash
# Build and run Eigendeck in Tauri dev mode on macOS.
# Re-runs npm install to get macOS-native binaries (safe if Linux overwrote them).
#
# Flags (order-independent, but must come before any --- app argv):
#   --debug    enable Debug menu (sets EIGENDECK_DEBUG=1)
#   --release  build Rust in release profile (--release passed to cargo
#              through tauri dev). Use this for perf testing: dev profile
#              leaves the image crate's PNG encode + Triangle resize
#              ~5-10x slower than release, which dominates render-loop
#              timing measurements.
#
# Examples:
#   bash tools/mac-build.sh                      # plain dev (debug profile)
#   bash tools/mac-build.sh--debug               # dev + Debug menu
#   bash tools/mac-build.sh--release             # release profile, no Debug menu
#   bash tools/mac-build.sh--debug --release     # release profile + Debug menu
#
# (We translate --debug to EIGENDECK_DEBUG=1 because Tauri's `tauri dev`
# argv passthrough places extra args BEFORE cargo's `--` separator, so a
# bare --debug reaches cargo and errors out instead of the app binary. The
# released binary still accepts --debug on argv directly.)

set -e
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")/.."   # tools/ -> repo root

release_mode=0
toolbar=0
while [ $# -gt 0 ]; do
  case "$1" in
    --debug)
      export EIGENDECK_DEBUG=1
      shift
      ;;
    --release)
      release_mode=1
      shift
      ;;
    --toolbar)
      # Build the native macOS NSToolbar spike (src-tauri/src/mac_toolbar.rs),
      # gated behind the `mac-toolbar` cargo feature. See docs/mac-native-toolbar.md.
      toolbar=1
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

npm install

# tauri-cli's --release goes BEFORE the second `--` so it reaches cargo,
# not the app binary. Remaining $@ are forwarded as app argv.
tauri_args=()
if [ "$release_mode" = "1" ]; then
  tauri_args+=(--release)
fi
if [ "$toolbar" = "1" ]; then
  # tauri-cli forwards --features to cargo.
  tauri_args+=(--features mac-toolbar)
fi

if [ $# -gt 0 ]; then
  npm run tauri dev -- "${tauri_args[@]}" -- "$@"
elif [ ${#tauri_args[@]} -gt 0 ]; then
  npm run tauri dev -- "${tauri_args[@]}"
else
  npm run tauri dev
fi
