#!/bin/bash
# Convert all example presentations from JSON to .eigendeck SQLite format.
# Imports presentation.json + all images and demos as assets.
# Keeps the original JSON directories intact.

set -e
source "$HOME/.cargo/env" 2>/dev/null

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

CLI="./src-tauri/target/debug/eigendeck-cli"

# Build CLI if needed
if [ ! -f "$CLI" ]; then
    echo "Building eigendeck-cli..."
    (cd src-tauri && cargo build --bin eigendeck-cli)
fi

converted=0
skipped=0

for dir in example-demos/*/; do
    json="${dir}presentation.json"
    if [ ! -f "$json" ]; then
        continue
    fi

    name=$(basename "$dir")
    eigendeck="examples/${name}.eigendeck"

    # Skip if already converted
    if [ -f "$eigendeck" ]; then
        echo "SKIP  ${name} (already exists)"
        skipped=$((skipped + 1))
        continue
    fi

    echo "CONVERT  ${name}"

    # Create DB and import JSON
    $CLI "$eigendeck" import json "$json"

    # Import image assets
    if [ -d "${dir}images" ]; then
        for img in "${dir}"images/*; do
            [ -f "$img" ] || continue
            relpath="images/$(basename "$img")"
            $CLI "$eigendeck" store-asset "$img" --as "$relpath" 2>/dev/null && \
                echo "  + $relpath" || echo "  ! Failed: $relpath"
        done
    fi

    # Import demo assets
    if [ -d "${dir}demos" ]; then
        for demo in "${dir}"demos/*; do
            [ -f "$demo" ] || continue
            relpath="demos/$(basename "$demo")"
            $CLI "$eigendeck" store-asset "$demo" --as "$relpath" 2>/dev/null && \
                echo "  + $relpath" || echo "  ! Failed: $relpath"
        done
    fi

    # Import other data files (e.g. JSON data for demos)
    if [ -d "${dir}graphs" ]; then
        for f in "${dir}"graphs/*; do
            [ -f "$f" ] || continue
            relpath="graphs/$(basename "$f")"
            $CLI "$eigendeck" store-asset "$f" --as "$relpath" 2>/dev/null && \
                echo "  + $relpath" || echo "  ! Failed: $relpath"
        done
    fi

    # Show summary
    $CLI "$eigendeck" info
    size=$(ls -lh "$eigendeck" | awk '{print $5}')
    echo "  Size: $size"
    echo ""

    converted=$((converted + 1))
done

echo "Done: ${converted} converted, ${skipped} skipped"
