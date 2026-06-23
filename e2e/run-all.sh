#!/bin/bash
# Gating e2e suite (Linux only). Runs each probe in the MANIFEST via run-probe.sh
# and exits non-zero if ANY probe fails — so `npm run test:e2e` is one command
# the release gate (and CI) can call. Each probe gets a FRESH temp HOME dir with
# its deck; the deck is either a COPY of a static source deck, or BUILT by a
# per-entry setup command (for fixtures that must be generated).
#
# Prereqs (see the eigendeck-e2e skill):
#   - E2E_APP built (default /tmp/el-target/debug/eigendeck)
#   - dist/ built with VITE_EIGENDECK_SEAM=1 npm run build
#   - eigendeck-cli built (for fixture setup commands) — CLI env var below
#
# MANIFEST entry format (pipe-separated, 4 fields):
#   "probe.mjs | deck | extra-env | setup-cmd"
#     probe.mjs   probe under e2e/
#     deck        if setup-cmd is EMPTY: a static source deck (path under repo
#                 root) that's COPIED into the temp HOME.
#                 if setup-cmd is PRESENT: just the BASENAME of the deck to build
#                 (e.g. fixture.eigendeck) — the setup command produces it.
#     extra-env   KEY=val ... passed to the probe (e.g. E2E_MODE=duplicate).
#                 May reference $DECK / $DECKDIR (the temp deck path / its dir).
#     setup-cmd   optional shell command that BUILDS the deck at $DECK. It runs
#                 with $DECK (target .eigendeck), $DECKDIR, $CLI, $ROOT in scope.
#
# Audit/diagnostic-only probes (no pass/fail assert, or non-deterministic) are
# intentionally NOT here — see e2e/README.md "Not yet gated".
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"
# CLI that builds fixture decks from JSON (import json). Pick the first that exists.
CLI="${E2E_CLI:-}"
for c in "$CLI" /work/src-tauri/target/debug/eigendeck-cli /tmp/el-target/debug/eigendeck-cli "$ROOT/src-tauri/target/debug/eigendeck-cli"; do
  [ -n "$c" ] && [ -x "$c" ] && { CLI="$c"; break; }
done

[ -x "$E2E_APP" ] || { echo "FATAL: E2E_APP not executable: $E2E_APP — build it (see eigendeck-e2e skill)"; exit 2; }
[ -d "$ROOT/dist" ] || { echo "FATAL: dist/ missing — run: VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }
# Guard against a plain (seam-less) build: every probe would hang on waitSeam.
grep -rq "__eigendeck" "$ROOT/dist/assets" 2>/dev/null || {
  echo "FATAL: dist/ has no __eigendeck seam — rebuild with VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }

# Helpers usable from setup-cmd: build a SQLite deck from a JSON the python
# builder emits. Usage: build_json <builder.py> <subcmd...>
EXFIX="$ROOT/e2e/fixtures"
# shellcheck disable=SC2317
import_json() { "$CLI" "$DECK" import json "$1" >/dev/null; }
# Build a clean single-slide, no-element deck at $DECK. Used by every editor /
# asset / video probe that asserts exact slide[0] contents or a save→reopen round
# trip — a committed example deck (with pre-existing elements + stripped history)
# breaks those assertions.
# shellcheck disable=SC2317
build_empty() { python3 "$EXFIX/make_e2e_decks.py" empty "$DECKDIR/empty.json" >/dev/null && import_json "$DECKDIR/empty.json"; }
EMPTY='build_empty'

MANIFEST=(
  # ── already-working entries (static example/fixture decks) ───────────────
  "present-clip-probe.mjs|examples/intro-slide.eigendeck||"
  "present-theme-parity-probe.mjs|examples/intro-slide.eigendeck||"
  "demo-theme-verify.mjs|examples/graph-explorer.eigendeck||"
  "demo-theme-scenario.mjs|examples/intro-slide.eigendeck||"
  "demo-theme-deck-verify.mjs|test-presentations/font-theme-matrix.eigendeck||"
  "demo-theme-recapture-probe.mjs|examples/intro-slide.eigendeck||"

  # ── editor / store correctness (clean empty deck; probes self-build) ─────
  "fontsize-probe.mjs|empty.eigendeck||$EMPTY"
  "group-probe.mjs|empty.eigendeck||$EMPTY"
  "kitchensink.mjs|empty.eigendeck||$EMPTY"
  "redo-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-nav-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-seed-history-probe.mjs|empty.eigendeck||$EMPTY"
  "text-undo-probe.mjs|empty.eigendeck||$EMPTY"
  "snap-grid-probe.mjs|empty.eigendeck||$EMPTY"
  # title-shift-probe is NOT gated — see e2e/README.md "Not yet gated"
  # (headless SVG glyph-geometry measurement reads null in this WebKit build).
  "zorder-probe.mjs|empty.eigendeck||$EMPTY"
  "styling-roundtrip.mjs|empty.eigendeck||$EMPTY"
  "sync-badge-reopen-probe.mjs|empty.eigendeck||$EMPTY"

  # ── asset missing / relocate (empty deck under HOME; probe writes files) ─
  "asset-missing-probe.mjs|empty.eigendeck||$EMPTY"
  "asset-relocate-offset-probe.mjs|empty.eigendeck||$EMPTY"
  "off-missing.mjs|empty.eigendeck||$EMPTY"

  # ── sync / link / promote round-trips (built fixture decks) ─────────────
  "roundtrip-probe.mjs|rt.eigendeck|E2E_MODE=linkpromote|python3 $EXFIX/make_roundtrip_decks.py ab \$DECKDIR/rt.json; import_json \$DECKDIR/rt.json"
  "roundtrip-probe.mjs|rt.eigendeck|E2E_MODE=duplicate|python3 $EXFIX/make_roundtrip_decks.py a \$DECKDIR/rt.json; import_json \$DECKDIR/rt.json"
  "roundtrip-reload-probe.mjs|rt.eigendeck|E2E_MODE=linkpromote|python3 $EXFIX/make_roundtrip_decks.py ab \$DECKDIR/rt.json; import_json \$DECKDIR/rt.json"
  "roundtrip-reload-probe.mjs|rt.eigendeck|E2E_MODE=duplicate|python3 $EXFIX/make_roundtrip_decks.py a \$DECKDIR/rt.json; import_json \$DECKDIR/rt.json"

  # ── notebook link/promote/free/resync (link-conflict fixture: nb1=MARK_A
  #    slide1, nb2=MARK_B slide2) ────────────────────────────────────────
  "link-smoke.mjs|lc.eigendeck||python3 $EXFIX/make_link_conflict_deck.py \$DECKDIR/lc.json; import_json \$DECKDIR/lc.json"
  "promote-chooser-probe.mjs|lc.eigendeck||python3 $EXFIX/make_link_conflict_deck.py \$DECKDIR/lc.json; import_json \$DECKDIR/lc.json"
  "nb-promote-reload.mjs|lc.eigendeck||python3 $EXFIX/make_link_conflict_deck.py \$DECKDIR/lc.json; import_json \$DECKDIR/lc.json"
  # resync + free-animate DUPLICATE the slide themselves → need a SOLO (one-slide,
  # nb1=MARK_A) deck, not the two-slide link-conflict deck.
  "resync-position-probe.mjs|solo.eigendeck||python3 $EXFIX/make_e2e_decks.py solo \$DECKDIR/solo.json; import_json \$DECKDIR/solo.json"
  "free-animate-reload-probe.mjs|solo.eigendeck|E2E_MODE=samesession|python3 $EXFIX/make_e2e_decks.py solo \$DECKDIR/solo.json; import_json \$DECKDIR/solo.json"
  "free-animate-reload-probe.mjs|solo.eigendeck|E2E_MODE=settled|python3 $EXFIX/make_e2e_decks.py solo \$DECKDIR/solo.json; import_json \$DECKDIR/solo.json"

  # ── notebook overlay / share / watch / copy-paste / export (built) ──────
  "notebook-reload-shared-probe.mjs|shared.eigendeck||python3 $EXFIX/make_e2e_decks.py shared \$DECKDIR/d.json; import_json \$DECKDIR/d.json"
  "copypaste-reload.mjs|copypaste.eigendeck||python3 $EXFIX/make_e2e_decks.py copypaste \$DECKDIR/d.json; import_json \$DECKDIR/d.json"
  "export-notebook-probe.mjs|export.eigendeck||python3 $EXFIX/make_e2e_decks.py export \$DECKDIR/d.json; import_json \$DECKDIR/d.json"
  # notebook-watch-takecontrol is NOT gated — see e2e/README.md "Not yet gated"
  # (real fs-watch depends on the per-user auto-reload preference run-probe wipes).

  # ── video (codec-INDEPENDENT: round-trip + byte-level file/caption watch) ─
  "video-roundtrip-probe.mjs|empty.eigendeck||$EMPTY"
  "video-watch-probe.mjs|empty.eigendeck||$EMPTY"
  "video-captions-watch-probe.mjs|empty.eigendeck||$EMPTY"

  # ── video (codec-DEPENDENT: need GStreamer plugins; present in this env) ──
  "video-decode-probe.mjs|empty.eigendeck||$EMPTY"
  "video-playback-probe.mjs|empty.eigendeck||$EMPTY"

  # ── demo rendering: the real talk-deck demos actually load/render, + #44
  #    hyphenated demo-piece names route end-to-end (truncation → UNMATCHED) ──
  "deck-demos-render-probe.mjs|examples/magnetic-powers.eigendeck||"
  "deck-demos-render-probe.mjs|examples/local-networks.eigendeck||"
  "deck-demos-render-probe.mjs|hp.eigendeck|E2E_EXPECT=FORCE-GRAPH-OK,BAR-CHART-2-OK|python3 $EXFIX/make_e2e_decks.py hyphenpiece \$DECKDIR/hp.json; import_json \$DECKDIR/hp.json"
)

pass=0; fail=0; failed=()
for entry in "${MANIFEST[@]}"; do
  IFS='|' read -r probe deck extra setup <<< "$entry"
  # Optional E2E_FILTER (regex) to run a SUBSET — the full suite is long, so CI /
  # local verification can chunk it (e.g. E2E_FILTER='undo|redo|video').
  if [ -n "${E2E_FILTER:-}" ] && ! printf '%s' "$probe" | grep -Eq "$E2E_FILTER"; then continue; fi
  [ -f "$ROOT/e2e/$probe" ] || { echo "✗ $probe — probe file missing"; fail=$((fail+1)); failed+=("$probe"); continue; }
  tmpdir="$(mktemp -d)"
  export DECKDIR="$tmpdir"
  export DECK="$tmpdir/$(basename "$deck")"

  if [ -n "$setup" ]; then
    [ -x "$CLI" ] || { echo "✗ $probe — eigendeck-cli not found (set E2E_CLI)"; fail=$((fail+1)); failed+=("$probe ($extra)"); rm -rf "$tmpdir"; continue; }
    if ! eval "$setup" >/tmp/e2e-setup.log 2>&1; then
      echo "✗ $probe — fixture setup failed:"; tail -5 /tmp/e2e-setup.log; fail=$((fail+1)); failed+=("$probe ($extra)"); rm -rf "$tmpdir"; continue
    fi
    [ -f "$DECK" ] || { echo "✗ $probe — setup did not produce $DECK"; fail=$((fail+1)); failed+=("$probe ($extra)"); rm -rf "$tmpdir"; continue; }
  else
    [ -f "$ROOT/$deck" ] || { echo "✗ $probe — source deck missing: $deck"; fail=$((fail+1)); failed+=("$probe"); rm -rf "$tmpdir"; continue; }
    cp "$ROOT/$deck" "$DECK"
  fi
  rm -f "$DECK-wal" "$DECK-shm"

  # Expand $DECK / $DECKDIR refs in extra-env.
  extra_expanded="$(eval echo "$extra")"
  label="$probe"; [ -n "$extra" ] && label="$probe [$extra_expanded]"
  echo "──── $label  ($deck) ────"
  # Retry on failure. Driving 30+ heavyweight WebKitGTK sessions back-to-back in
  # one run periodically leaves the rig unable to START the next session for a
  # ~1-2 min window (the probe reports "open"/"no seam"/"S1 open" or a connection
  # error) — a transient, not a real assertion failure. A genuinely broken probe
  # fails EVERY attempt; a flake passes once the window clears. We try up to 3×
  # with a GROWING backoff so a retry lands AFTER the bad window, not inside it.
  rc=1; tries=3
  for try in $(seq 1 $tries); do
    env $extra_expanded PROBE="$ROOT/e2e/$probe" E2E_DECK="$DECK" bash "$ROOT/e2e/run-probe.sh" 2>&1 | tail -4
    rc=${PIPESTATUS[0]}
    [ "$rc" -eq 0 ] && break
    if [ "$try" -lt "$tries" ]; then
      back=$((try*8))   # 8s, 16s — ride out the degraded window before retrying
      echo "  … $label rc=$rc — retry $((try+1))/$tries in ${back}s"
      sleep "$back"
    fi
  done
  rm -rf "$tmpdir"
  if [ "$rc" -eq 0 ]; then echo "  ✓ $label"; pass=$((pass+1)); else echo "  ✗ $label (rc=$rc)"; fail=$((fail+1)); failed+=("$label"); fi
done
unset DECK DECKDIR

echo "════════════════════════════"
echo "e2e: $pass passed, $fail failed (of $((pass+fail)))"
if [ "$fail" -ne 0 ]; then printf '  FAILED: %s\n' "${failed[@]}"; exit 1; fi
echo "ALL E2E PASS"
