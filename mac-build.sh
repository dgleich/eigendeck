#!/bin/bash
# Build and run Eigendeck in Tauri dev mode on macOS
# Re-runs npm install to get macOS-native binaries (safe if Linux overwrote them)

set -e
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"
npm install
npm run tauri dev
