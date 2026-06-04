# Notebook E2E (headless WebDriver)

End-to-end tests that drive the **real built app** via `tauri-driver` +
`WebKitWebDriver` under `xvfb`. These catch frontend↔Rust boundary bugs
that unit tests (mocked `invoke`) cannot — e.g. overlay load/merge,
persistence, and the duplicate→share flow.

## Platform

**Linux only.** `tauri-driver` has no macOS support, so this runs in CI /
a Linux box, not the Mac dev loop.

## Prerequisites

```bash
sudo apt-get install -y xvfb webkit2gtk-driver        # Xvfb + WebKitWebDriver
cargo install tauri-driver                            # WebDriver bridge
```

## Build the app

A **debug** build loads `devUrl` (the vite dev server), so `run.sh` serves
`dist/` on :1420 as a stand-in. A proper CI job should build a **release**
binary (self-contained, embeds `dist/`) and skip the server:

```bash
npm run build                                          # produce dist/
cargo build --bin eigendeck                            # debug binary
# (CI: cargo build --release --bin eigendeck, then drop the :1420 server)
```

Set `E2E_APP` to the binary (default `/tmp/el-target/debug/eigendeck`).

## Run

```bash
# 1. generate fixture decks (needs eigendeck-cli built)
python3 e2e/fixtures/make_overlay_deck.py single /tmp/ov-single.json
eigendeck-cli /tmp/ov-single.eigendeck import json /tmp/ov-single.json

# 2. run a scenario: open the deck via launch-arg, assert DOM
E2E_DECK=/tmp/ov-single.eigendeck \
E2E_EXPECT=EDITED_OVERLAY_MARKER E2E_ABSENT="k = 5" \
  bash e2e/run.sh
```

The app is launched with the deck path as an argument (the .eigendeck
file-association seam), so no native Open dialog is involved. Save-in-place
(Cmd+S / autosave) is also dialog-free, so the full record→save→reopen
round-trip is drivable.

## What's covered

- **load** — app opens a deck passed as a launch arg.
- **overlay-load** — overlay loads + merges (edited cell shows, raw hidden).
- **overlay-heal** — a deck with two overlays for one element (the test-1
  corruption) loads the content-bearing one.
- **B2 duplicate** — Duplicate → the copy shows the SHARED overlay.
- **link-conflict chooser** — linking two notebooks with DIFFERENT recordings
  raises the "which to keep?" chooser; picking one keeps it and discards the
  other. Has its own driver (clicks through the modal), not `check.mjs`:

  ```bash
  python3 e2e/fixtures/make_link_conflict_deck.py /tmp/lc.json
  eigendeck-cli /tmp/lc.eigendeck import json /tmp/lc.json
  # then run link-smoke.mjs under the same xvfb+tauri-driver harness as run.sh,
  # with E2E_APP and E2E_DECK=/tmp/lc.eigendeck (see run.sh for the wrapper).
  ```

See `../.claude/notes/notebook-edge-cases-findings.md` for findings.
