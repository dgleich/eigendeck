#!/bin/bash
# Build the eigendeck-cli binary
cd src-tauri && cargo build --bin eigendeck-cli --release
echo ""
echo "Built: src-tauri/target/release/eigendeck-cli"
echo ""
echo "Usage:"
echo "  ./src-tauri/target/release/eigendeck-cli myproject.eigendeck info"
echo "  ./src-tauri/target/release/eigendeck-cli myproject.eigendeck outline"
echo "  ./src-tauri/target/release/eigendeck-cli myproject.eigendeck history"
echo "  ./src-tauri/target/release/eigendeck-cli myproject.eigendeck search \"query\""
echo "  ./src-tauri/target/release/eigendeck-cli --help"
