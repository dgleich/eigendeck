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
- **link is non-destructive** — `link-smoke.mjs`: clicking a target in the "L"
  picker establishes an *animation link* only — it asserts NO sync/merge chooser
  appears and neither recording is touched. (The link-conflict fixture,
  `make_link_conflict_deck.py`, nb1=MARK_A / nb2=MARK_B.)
- **promote chooser** — `promote-chooser-probe.mjs`: when you PROMOTE
  (link→sync) two notebooks that hold DIFFERENT recordings, a chooser lists each
  and the picked copy's recording is kept. Drives link → `promote-to-sync` event
  → clicks the slide-2 card → asserts MARK_B kept, MARK_A discarded, one entry.
  (Same fixture.)

- **sync/link round-trip** — `roundtrip-probe.mjs` drives store actions
  (duplicate / linkElements / promoteToSync) via the `window.__eigendeck` seam,
  runs the REAL `flushToSqlite`, then `db_export_json`, and asserts the persisted
  structure: duplicate & promote → one entry (shared id + syncId); link → shared
  linkId with separate positions and no syncId. This is the in-session→save
  reopen path end-to-end.

  ```bash
  python3 e2e/fixtures/make_roundtrip_decks.py ab /tmp/rt-ab.json
  eigendeck-cli /tmp/rt-ab.eigendeck import json /tmp/rt-ab.json
  # run roundtrip-probe.mjs under run.sh's xvfb+tauri-driver wrapper with
  # E2E_DECK=/tmp/rt-ab.eigendeck E2E_MODE=linkpromote  (or 'a' deck + duplicate)
  ```

- **true close+reopen round-trip** — `roundtrip-reload-probe.mjs`: TWO app
  sessions — session 1 opens, runs a store op, flush + `save()`, then QUITS;
  session 2 launches FRESH on the saved file and asserts the structure
  (`E2E_MODE=duplicate` → one synced entry; `linkpromote` → link then promote →
  one entry). The real save→close→reopen path.
- **notebook promote round-trip** — `nb-promote-reload.mjs`: two notebooks with
  their own recordings (nb1=MARK_A / nb2=MARK_B) → link → promote nb1 → save →
  QUIT → relaunch → assert the master's recording (MARK_A) survived, MARK_B
  discarded, one synced entry. Combined promote + overlay + close/reopen.
- **copy carries the recording** — `copypaste-reload.mjs`: copy a notebook with
  a recording → paste on a different slide (cross-slide → linked copy) → save →
  QUIT → relaunch → assert the pasted notebook still shows its recording.

All the `*-reload.mjs` / `*-probe.mjs` drivers use the `window.__eigendeck`
seam (store + flush + save) and run under run.sh's xvfb + tauri-driver wrapper
with `E2E_APP` / `E2E_DECK` (some also `E2E_MODE`); decks must be SQLite, so
convert JSON fixtures with `eigendeck-cli out.eigendeck import json in.json`.

- **notebook file-watching + take control** — `notebook-watch-takecontrol-probe.mjs`
  drives the REAL fs-watch end-to-end: mutate the linked `.ipynb` on disk →
  notebook auto-reloads; take control (make editable → watching off) → mutate →
  does NOT reload; make an in-deck edit → save → QUIT → relaunch → edit persists;
  "Reload from disk now" → latest file shown + edit wiped; re-enable watching →
  mutate → reloads again.

  ⚠️ **fs-watch scope:** `fs:allow-watch` only covers the home / documents /
  desktop / downloads / temp dirs. Files in an arbitrary `/tmp/...` path are NOT
  in scope and watch() throws "forbidden path". The probe runs with the app's
  **`HOME=/tmp`** so the deck + `.ipynb` live under `scope-home-recursive`.
  (Real users' decks live in home/Documents, so it just works.)

### Known-failing regression probes (drive open bugs; flip to PASS when fixed)

- **S5c free→move→animate round-trip** — `free-animate-reload-probe.mjs`
  (`E2E_MODE=samesession|settled`): duplicate a slide → free the slide-2 instance
  → move it +300 → save → reopen. Asserts TWO distinct rows (slide 1 @ x=60,
  slide 2 @ x=360), neither synced, both sharing one `linkId` (animation pairing),
  recording intact on the moved frame. **Currently FAILS** — reopen collapses to
  one synced entry at x=60 (the move + free are lost). The headline animation
  workflow. Likely fix: `freeElement` gives the freed instance a fresh id so it
  splits onto its own row.
- **S2 resync position reconcile** — `resync-position-probe.mjs`: duplicate →
  free + move (positions diverge to [60,260]) → resync. Asserts resync SNAPS to
  the canonical position (decision 2026-06): in-session [60,60], a later synced
  move keeps both equal, and it round-trips. **Currently FAILS** — resync leaves
  [60,260] in-session (two synced members at different x) and a later move keeps a
  permanent offset [70,270].

See `../.claude/notes/notebook-edge-cases-findings.md` for findings.
