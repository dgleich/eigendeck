#!/bin/bash
# Build and run Eigendeck in Tauri dev mode on Linux (Ubuntu 22.04+)
# Re-runs npm install to get Linux-native binaries (safe if macOS overwrote them)

set -e
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"
npm install
npm run tauri dev
