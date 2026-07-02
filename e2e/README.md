# Notebook E2E (headless WebDriver)

End-to-end tests that drive the **real built app** via `tauri-driver` +
`WebKitWebDriver` under `xvfb`. These catch frontend↔Rust boundary bugs
that unit tests (mocked `invoke`) cannot — e.g. overlay load/merge,
persistence, and the duplicate→share flow.

## Gating suite (`npm run test:e2e`)

`e2e/run-all.sh` is the **gate**: it runs a manifest of pass/fail probes via
`run-probe.sh`, aggregates results, and exits non-zero if any fail (ending with
`ALL E2E PASS` on success). `package.json`'s `test:e2e` calls it. Run it with the
prebuilt app binary:

```bash
E2E_APP=/tmp/elrig/eigendeck bash e2e/run-all.sh
```

Each manifest entry is `probe.mjs | deck | extra-env | setup-cmd`:
- **deck** — when `setup-cmd` is empty, a static source deck (copied into a fresh
  temp `HOME`). When `setup-cmd` is present, just the BASENAME of the deck to
  build.
- **extra-env** — `KEY=val …` passed to the probe (e.g. `E2E_MODE=duplicate`); may
  reference `$DECK` / `$DECKDIR`.
- **setup-cmd** — optional shell that BUILDS the deck at `$DECK` (a fixture
  generator → `eigendeck-cli $DECK import json …`). It has `$DECK`, `$DECKDIR`,
  `$CLI`, `$ROOT`, and the `import_json <json>` helper in scope. The CLI is
  auto-located (override with `E2E_CLI`).

Fixture builders: `fixtures/make_roundtrip_decks.py` (sync/link),
`fixtures/make_link_conflict_deck.py` (nb1=MARK_A / nb2=MARK_B), and
`fixtures/make_e2e_decks.py` (`shared` / `copypaste` / `export` / `watch` notebook
decks).

### Not yet gated (intentionally excluded)

These live in `e2e/` but are NOT in `run-all.sh`, by design:

- **overflow-hunt.mjs** — audit/diagnostic: walks a deck and *reports* overflowing
  text; no PASS/FAIL, always exits 0.
- **check.mjs** — the generic parameterized DOM asserter; needs `E2E_EXPECT`/
  `E2E_ABSENT`, not a standalone scenario (it's the engine the other probes
  predate).
- **ipc-bytes-probe.mjs** — diagnostic: measures how Tauri IPC accepts byte args
  (#174). Prints `IPC_BYTES_RESULT` and exits 0 regardless of correctness (only
  fails on infra/session errors), so it can't gate.
- **store-timing-probe.mjs** — perf benchmark: times `db_store_asset` for 10/50/
  100 MB and prints `STORE_TIMING`; exits 0 on success, no behavioral assert.
- **undo-granularity-probe.mjs** — measurement (#55): prints undo-stack depths
  for drag/typing coalescing; always exits 0, no pass/fail.
- **notebook-watch-takecontrol-probe.mjs** — exercises the REAL OS fs-watch
  (mutate the linked `.ipynb` on disk → notebook reloads). Whether watching is
  active depends on the per-user `autoReloadAssets` preference, which
  `run-probe.sh` wipes (`XDG_DATA_HOME`) on every run, so step 1 ("fs-watch
  reloaded WATCHED1") is non-deterministic in the gate. It passes interactively /
  with the preference on; the asset-reload merge path it shares is covered
  deterministically by `notebook-reload-shared-probe.mjs` (which drives the
  `eigendeck:asset-changed` event directly). Run it standalone via `run-probe.sh`
  with `E2E_NB=<deckdir>/nb.ipynb` and the `watch` fixture deck.
- **title-shift-probe.mjs** — #47 visual regression: measures the on-screen glyph
  rectangle of a title in display (SVG `foreignObject`) vs edit (contentEditable)
  mode and asserts they don't shift. In this headless WebKit build the display
  measurement reads `null` (the glyph Range rect isn't resolvable), so it can't
  gate. The text-render path is covered deterministically by the
  `buildTextElementSvgMarkup` unit test (`src/components/TextElementSvg.test.ts`).

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
VITE_EIGENDECK_SEAM=1 npm run build                    # produce dist/ WITH the seam
cargo build --bin eigendeck                            # debug binary
# (CI: cargo build --release --bin eigendeck, then drop the :1420 server)
```

> **The `VITE_EIGENDECK_SEAM=1` is required.** The probes drive the app through
> `window.__eigendeck`, which is installed only in a dev build or when this flag
> is baked into the dist. A plain release build tree-shakes it away entirely
> (it's a dev/test-only hook, not a user-facing feature).

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

- **S5c free→move→animate round-trip** — `free-animate-reload-probe.mjs`
  (`E2E_MODE=samesession|settled`): duplicate a slide → free the slide-2 instance
  → move it +300 → save → reopen. Asserts TWO distinct rows (slide 1 @ x=60,
  slide 2 @ x=360), neither synced, both sharing one `linkId` (animation pairing),
  recording intact on the moved frame. The headline animation workflow — `freeElement`
  gives the freed instance a fresh id so it splits onto its own DB row.
- **S2 resync position reconcile** — `resync-position-probe.mjs`: duplicate →
  free + move (positions diverge to [60,260]) → resync. Asserts resync SNAPS to
  the canonical position (decision 2026-06): in-session [60,60], a later synced
  move keeps both equal, and it round-trips.

See `../.claude/notes/notebook-edge-cases-findings.md` for findings.

### Video probes

- **video-watch-probe.mjs** — a local video bound to an external file reloads on
  disk change (byte-level; no codecs). Needs an empty deck under `HOME=/tmp`.
- **video-captions-watch-probe.mjs** — the `.vtt` captions sidecar is watched too
  (edit it on disk → the asset reloads). Byte-level.
- **video-roundtrip-probe.mjs** — file + embed video elements survive save→reopen
  with all fields (kind, assetId, provider, url, loop, pingPong, playbackRate,
  controls, muted). Codec-independent.
- **video-decode-probe.mjs** — REAL decode + frame-capture + playback, using the
  committed `fixtures/test.webm` (vp8). **Codec-dependent:** needs WebKit's
  GStreamer media plugins — `gstreamer1.0-plugins-good` (vpx) decodes the webm;
  add `gstreamer1.0-libav` for h264/mp4. (They're present in the dev container;
  CI must apt-install them.) Asserts the `<video>` decoded (readyState/size/
  duration), a real poster PNG was cached, and muted playback advances.
- **video-playback-probe.mjs** — REAL loop + ping-pong: asserts native loop wraps
  currentTime back to the start, and ping-pong plays forward then reverse-seeks
  back down (rAF runs headlessly). Codec-dependent (uses the webm fixture).

### Asset security (docs/ASSETS-SECURITY.md)

The trust/approve gate: a linked file is read/watched only when the deck is trusted
AND its path approved. Fixtures must use real-enough bytes (mp4 `ftyp`, leading
`<svg>`, `WEBVTT`) or the content gate rejects them. Watch probes trust the (CLI-
built, untrusted) fixture via `window.__eigendeck.trustDeck()` first — the real
"Trust this deck" action.

- **asset-trust-states-probe.mjs** — one deck through the whole matrix in one launch:
  untrusted → trust → trusted-but-unapproved-new-path → approve → revoke. Asserts a
  watched video's bytes follow disk exactly in the "watched" states and never in the
  others (zero reads when untrusted/unapproved/revoked).
- **asset-open-untrusted-probe.mjs** — opening an untrusted deck whose linked source
  changed while closed does ZERO reads (snapshot stays).
- **asset-open-trusted-probe.mjs** — opening a trusted deck reconciles the changed
  source on open, and proves trust persists across the reopen (token in deck + ledger
  in appData). Uses an svg image asset (headless WebKit hangs re-rendering a synthetic
  mp4 during init — a container artifact).
- **asset-approval-cleanup-probe.mjs** — ledger hygiene: relocating an asset re-points
  its approval in place; the old resolved path is dropped, leaving no orphan (asserts
  the raw ledger approvals via the `trustReport` seam). The delete/reconcile-on-save
  side is unit-covered (`trustStore.test.ts`).
- **off-missing.mjs** — a missing source is flagged even when auto-reload is OFF, on a
  trusted deck (#74 ungating).
- The exhaustive content-gate matrix is a **unit** test: `src/lib/assetTypes.test.mjs`
  (every content family × extension; garbage; non-allowlisted extensions).

### Demo theme inheritance (#86) + text clipping (#79)

- **demo-theme-verify.mjs** — injects the deck's `@font-face` (shared URL) + theme
  vars into a demo's `contentDocument`; asserts a theme switch updates the vars
  LIVE with **no iframe reload** (demo state preserved) and the font loads.
- **demo-theme-scenario.mjs** — builds a 40-slide deck (10 `FONT_PACKAGES` × 4
  themes), full-bleed `fixtures/theme-probe-demo.html` per slide; asserts every
  `--eigendeck-*` color = the slide's theme AND the slide's font face loads
  (PASS 40/40). Self-contained (builds its own deck).
- **demo-theme-deck-verify.mjs** — opens an EXISTING deck and verifies each demo
  matches its slide's theme + font. Point `E2E_DECK` at
  `test-presentations/font-theme-matrix.eigendeck` (the committed fixture).
- **present-clip-probe.mjs** — #79 regression: a title that overflows its box is
  CLIPPED in present mode (rendered box computes `overflow:hidden` AND content
  genuinely exceeds the box). The deterministic markup guard is the
  `buildTextElementSvgMarkup` unit test (`src/components/TextElementSvg.test.ts`).
- **overflow-hunt.mjs** — audit (not pass/fail): walks a deck and reports text
  elements whose content overflows its box (surfaced the #95 cut-off risk).
- **deck-demos-render-probe.mjs** — opens a deck and asserts every demo /
  demo-piece iframe actually renders (contentDocument reachable + non-empty). Gated
  against the real talk decks (`magnetic-powers`, `local-networks`) so a broken or
  re-themed demo is caught. With `E2E_EXPECT=<csv>` it also asserts text appears in
  a demo body — used with the `hyphenpiece` fixture to prove **hyphenated
  demo-piece names route end-to-end (#44)**: the demo renders `FORCE-GRAPH-OK`
  only if `force-graph` wasn't truncated to `force`. (Detection-on-add is covered
  by the `extractDemoPieceNames` unit test.)
