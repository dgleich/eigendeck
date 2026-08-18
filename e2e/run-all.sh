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
# Match the seam ASSIGNMENT (`.__eigendeck={…}`), NOT any `__eigendeck` occurrence:
# a plain (seam-less) `npm run build` still leaves stray `.__eigendeck` *reads*
# (type casts) in the bundle, so a bare `grep __eigendeck` FALSE-POSITIVES and the
# suite runs seam-less — every probe then times out on waitSeam while the frontend
# loads fine, which reads as "decks won't open." See the eigendeck-e2e skill.
grep -rq "__eigendeck={" "$ROOT/dist/assets" 2>/dev/null || {
  echo "FATAL: dist/ has no __eigendeck seam ASSIGNMENT — a plain 'npm run build' strips it."
  echo "       Rebuild with: VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }

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
  "present-navkey-probe.mjs|navkey.eigendeck||import_json \$EXFIX/internal-paste-deck.json"   # #155 present nav-key message routing (demo-swallowed Space/arrows)
  "present-html-interactive-navkey-probe.mjs|htmlint.eigendeck||import_json \$ROOT/e2e/fixtures/html-interactive-deck.json"   # #155 CAVEAT: interactive html iframe is script-less + forwarder-less (nav keys swallowed) — regression guard
  "present-theme-parity-probe.mjs|examples/intro-slide.eigendeck||"
  "present-projector-probe.mjs|examples/intro-slide.eigendeck||"
  # #134 present-mode VISUAL check via the in-app seam capture (captureElement),
  # NOT WebDriver /screenshot which hangs in headless present. Asserts non-blank pixels.
  "present-visual-probe.mjs|present-visual.eigendeck||import_json \$ROOT/e2e/fixtures/present-visual-deck.json"
  "demo-theme-verify.mjs|examples/graph-explorer.eigendeck||"
  "demo-theme-scenario.mjs|examples/intro-slide.eigendeck||"
  "demo-theme-deck-verify.mjs|test-presentations/font-theme-matrix.eigendeck||"
  "demo-theme-recapture-probe.mjs|examples/intro-slide.eigendeck||"
  "import-html-probe.mjs|examples/intro-slide.eigendeck||"   # #164 export->import round-trip (Unicode)
  "welcome-roundtrip-probe.mjs|examples/welcome.eigendeck||"   # HTML export->import restores assets (single-store)
  "export-print-layer-probe.mjs|examples/intro-slide.eigendeck||"   # #109 interactive HTML export embeds a printable inch-based print layer
  "export-print-demo-probe.mjs|printdemo.eigendeck||python3 $EXFIX/make_e2e_decks.py printdemo \$DECKDIR/pd.json; import_json \$DECKDIR/pd.json"   # #109 print layer doesn't break the LIVE demo/html/notebook in the interactive export
  "snapshot-command-probe.mjs|examples/graph-explorer.eigendeck||"   # Generate Missing Snapshots flips through + re-caches a live-element preview
  "element-fidelity-probe.mjs|examples/welcome.eigendeck||"   # every element PROPERTY survives import (asset types)
  "element-fidelity-probe.mjs|all-elements.eigendeck||import_json $ROOT/e2e/fixtures/all-elements-deck.json"   # video/html/cover/rich-text/arrow
  "element-fidelity-probe.mjs|stylematrix.eigendeck||python3 $EXFIX/make_style_matrix_deck.py \$DECKDIR/sm.json; import_json \$DECKDIR/sm.json"   # every export-matrix STYLE round-trips
  "demo-preview-bg-probe.mjs|examples/intro-slide.eigendeck||"

  # ── editor / store correctness (clean empty deck; probes self-build) ─────
  "sync-orphan-probe.mjs|examples/intro-slide.eigendeck||"
  "backspace-sidebar-probe.mjs|examples/intro-slide.eigendeck||"
  "fontsize-probe.mjs|empty.eigendeck||$EMPTY"
  "group-probe.mjs|empty.eigendeck||$EMPTY"
  "kitchensink.mjs|empty.eigendeck||$EMPTY"
  "redo-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-nav-probe.mjs|empty.eigendeck||$EMPTY"
  "undo-seed-history-probe.mjs|empty.eigendeck||$EMPTY"
  "text-undo-probe.mjs|empty.eigendeck||$EMPTY"
  "text-edit-newslide-probe.mjs|textedit.eigendeck||import_json \$ROOT/e2e/fixtures/text-edit-deck.json"   # #177 CRITICAL: in-progress text edit survives New Slide (commit-after-slide-change)
  "snap-grid-probe.mjs|empty.eigendeck||$EMPTY"
  # title-shift-probe is NOT gated — see e2e/README.md "Not yet gated"
  # (headless SVG glyph-geometry measurement reads null in this WebKit build).
  "zorder-probe.mjs|empty.eigendeck||$EMPTY"
  "insert-dup-keys-probe.mjs|empty.eigendeck||$EMPTY"   
  "paste-text-probe.mjs|empty.eigendeck||$EMPTY"   # #161 paste plain/styled text → text element (color kept, font-size dropped)
  "paste-file-probe.mjs|empty.eigendeck||$EMPTY"   # #160 paste a copied FILE (uri-list) → insert as an image asset
  "internal-paste-probe.mjs|ip.eigendeck||import_json $EXFIX/internal-paste-deck.json"   # copy/paste redesign: private-flavor round-trip + stale guard
  "image-link-probe.mjs|imglink.eigendeck||import_json $EXFIX/image-link-deck.json"   # copy/paste redesign: image copy -> paste + cross-slide link
  "caret-double-paste-probe.mjs|caret-paste.eigendeck||import_json $EXFIX/caret-paste-deck.json"   # editing + paste must NOT create a canvas element (double-paste guard)
  "styling-roundtrip.mjs|empty.eigendeck||$EMPTY"
  "sync-badge-reopen-probe.mjs|empty.eigendeck||$EMPTY"

  # ── asset missing / relocate (empty deck under HOME; probe writes files) ─
  "asset-missing-probe.mjs|empty.eigendeck||$EMPTY"
  "asset-relocate-offset-probe.mjs|empty.eigendeck||$EMPTY"
  "off-missing.mjs|empty.eigendeck||$EMPTY"
  # ── asset-security spec conformance (trusted/untrusted × approved × watched) ─
  "asset-trust-states-probe.mjs|empty.eigendeck||$EMPTY"
  "asset-open-untrusted-probe.mjs|empty.eigendeck||$EMPTY"
  "asset-open-trusted-probe.mjs|empty.eigendeck||$EMPTY"
  "asset-watch-warning-probe.mjs|empty.eigendeck||$EMPTY"
  "security-actions-probe.mjs|empty.eigendeck||$EMPTY"
  # REAL second-window trust: drives the actual Security window (window-handle
  # switch) + clicks the real "Trust this deck" button — NOT the trust seam — and
  # asserts trust reaches + persists on the MAIN deck. Catches the trust-
  # persistence bug the seam-based probes structurally could not (seam discipline).
  "security-window-trust-probe.mjs|empty.eigendeck||$EMPTY"
  "settings-window-probe.mjs|examples/intro-slide.eigendeck||"
  "keyboard-shortcuts-probe.mjs|examples/intro-slide.eigendeck||"
  "context-menu-target-probe.mjs|examples/intro-slide.eigendeck||"
  "demo-mount-gate-probe.mjs|empty.eigendeck||$EMPTY"

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
  "export-image-deck-probe.mjs|examples/intro-slide.eigendeck||"
  # #123: a committed source edit must survive a deck save WITHIN the overlay's
  # 800ms flush debounce + a hard close (regression guard for the data-loss race;
  # kernel-free — edits + blurs to commit, never runs a cell).
  "nb-overlay-save-flush-probe.mjs|saveflush.eigendeck||python3 $EXFIX/make_live_nb_deck.py \$DECKDIR/saveflush.json; import_json \$DECKDIR/saveflush.json"
  # notebook-watch-takecontrol is NOT gated — see e2e/README.md "Not yet gated"
  # (real fs-watch depends on the per-user auto-reload preference run-probe wipes).
  # nb-live-run-persist is NOT gated — needs a REAL jupyter server (uv + network
  # for the first venv build), so it's non-hermetic. Enable when the CI image
  # ships jupyter. To run standalone see e2e/README.md "Live kernel".
  # "nb-live-run-persist.mjs|live.eigendeck|E2E_JUPYTER=1|python3 $EXFIX/make_live_nb_deck.py \$DECKDIR/live.json; import_json \$DECKDIR/live.json"

  # ── video (codec-INDEPENDENT: round-trip + byte-level file/caption watch) ─
  # #152 YouTube loopback shim: the Rust server's security hardening (id/Host/
  # token/method allowlists, no-CORS, CSP/nosniff), driven against the REAL app.
  "youtube-shim-probe.mjs|examples/intro-slide.eigendeck||"
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

  # ── visual: themed Card fill (#132), the live 'accent' color token + cover
  #    tint (re-adapts on theme change), and font-resolution priority ──────────
  "card-render-probe.mjs|card.eigendeck||import_json \$ROOT/e2e/fixtures/card-deck.json"
  "color-token-probe.mjs|token.eigendeck||import_json \$ROOT/e2e/fixtures/color-token-deck.json"
  "font-default-probe.mjs|font-ptsans.eigendeck|E2E_EXPECT=ptsans|import_json \$ROOT/e2e/fixtures/font-ptsans-deck.json"
  "font-default-probe.mjs|font-lato.eigendeck|E2E_EXPECT=lato|import_json \$ROOT/e2e/fixtures/font-lato-deck.json"
  "color-control-probe.mjs|ctrl.eigendeck||import_json \$ROOT/e2e/fixtures/color-control-deck.json"
  "cover-card-probe.mjs|cover.eigendeck||import_json \$ROOT/e2e/fixtures/cover-card-deck.json"
  # #95 editor cut-off badge: overflowing text shows it, fitting text doesn't
  # (jsdom can't measure overflow, so this needs the real rig).
  "text-overflow-probe.mjs|overflow.eigendeck||import_json \$ROOT/e2e/fixtures/overflow-text-deck.json"
  # #136 right-click context menu opens for every element type, incl. the html
  # iframe (whose overlay could swallow contextmenu). Real right-click via WebDriver.
  "context-menu-elements-probe.mjs|ctxmenu.eigendeck||import_json \$ROOT/e2e/fixtures/contextmenu-deck.json"
  # #158 Google Slides image paste: image embedded in text/html (<img data:> in a
  # <b docs-internal-guid>), no image on the clipboard → must still insert an image.
  "gslides-paste-probe.mjs|gslides.eigendeck||import_json \$ROOT/e2e/fixtures/gslides-paste-deck.json"
  # #135 footer: presence/absence (per-slide omitFooter) + deck footerFont across
  # editor, present, and HTML export (print path covered by exportMatrix units).
  "footer-probe.mjs|footer.eigendeck||import_json \$ROOT/e2e/fixtures/footer-deck.json"
  "slide-delete-probe.mjs|slidedel.eigendeck||import_json \$ROOT/e2e/fixtures/slide-delete-deck.json"
  "present-cover-probe.mjs|slidedel.eigendeck||import_json \$ROOT/e2e/fixtures/slide-delete-deck.json"
  "theme-persist-probe.mjs|themesave.eigendeck||import_json \$ROOT/e2e/fixtures/slide-delete-deck.json"
  "hud-remeasure-probe.mjs|hud.eigendeck||import_json \$ROOT/e2e/fixtures/slide-delete-deck.json"
  "a1-present-midedit-loss-probe.mjs|a1mid.eigendeck||import_json \$ROOT/e2e/fixtures/a1-present-lifecycle-deck.json"
  "a4-image-visuals.mjs|a4img.eigendeck||python3 $EXFIX/make_a4_image_deck.py \$DECKDIR/a4img.json; import_json \$DECKDIR/a4img.json"
  "a1-speaker-stale-flag-probe.mjs|a1life.eigendeck||import_json \$ROOT/e2e/fixtures/a1-present-lifecycle-deck.json"
  "a1-present-escape-invariants-probe.mjs|a1life.eigendeck||import_json \$ROOT/e2e/fixtures/a1-present-lifecycle-deck.json"
  "a1-present-render-nav-probe.mjs|a1life.eigendeck||import_json \$ROOT/e2e/fixtures/a1-present-lifecycle-deck.json"
  "a1-present-startslide-repeat-probe.mjs|a1life.eigendeck||import_json \$ROOT/e2e/fixtures/a1-present-lifecycle-deck.json"
  "a2-config-slide.mjs|a2cfg.eigendeck||import_json \$ROOT/e2e/fixtures/a2-cfg-deck.json"
  "a2-elprops.mjs|a2el.eigendeck||import_json \$ROOT/e2e/fixtures/a2-elprops-deck.json"
  "a2-undo.mjs|a2undo.eigendeck||import_json \$ROOT/e2e/fixtures/a2-undo-deck.json"
  "a2-clear-props.mjs|a2clear.eigendeck||import_json \$ROOT/e2e/fixtures/a2-clear-deck.json"
  "a4-arrow-visuals.mjs|a4arrow.eigendeck||import_json \$ROOT/e2e/fixtures/a4-arrowvis-deck.json"
  "arrow-spline-probe.mjs|arrspline.eigendeck||import_json \$ROOT/e2e/fixtures/arrow-spline-deck.json"
  "html-element-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  # #137 raw-HTML element — security + all render/output paths in REAL WebKit.
  # The two security probes are the high-value ones jsdom cannot do: no-script
  # (script/onerror never fire, parent+frame uncompromised) and no-egress (CSP
  # blocks remote img/link while data: loads). Then persistence round-trip,
  # inspector textarea + background, present/thumbnail lock, duplicate/delete,
  # undo/redo.
  "html-security-noscript-probe.mjs|htmlsec.eigendeck||import_json \$ROOT/e2e/fixtures/html-security-deck.json"
  "html-security-network-probe.mjs|htmlnet.eigendeck||import_json \$ROOT/e2e/fixtures/html-network-deck.json"
  "html-persist-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  "html-inspector-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  "html-present-render-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  "html-thumbnail-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  "html-duplicate-delete-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  "html-undo-redo-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  # undo captured for the REAL edit UIs (Inspector textarea + in-canvas contentEditable),
  # not just a store-level updateElement.
  "html-ui-undo-probe.mjs|htmlel.eigendeck||import_json \$ROOT/e2e/fixtures/html-element-deck.json"
  # opt-in `interactive` flag: a pure-CSS radio/:checked thermometer is clickable
  # in the editor interact-mode + present (pointer-events plumbing), no JavaScript.
  "html-interactive-probe.mjs|htmlint.eigendeck||import_json \$ROOT/e2e/fixtures/html-interactive-deck.json"
  # regression: a deck with NO config block must still present (PresentMode defaults
  # 1920×1080; without it the stage collapsed to 0×0 → present showed nothing).
  "html-present-stage-probe.mjs|htmlnc.eigendeck||import_json \$ROOT/e2e/fixtures/html-noconfig-deck.json"
  "a4-text-cover.mjs|a4txt.eigendeck||import_json \$ROOT/e2e/fixtures/a4-textcover-deck.json"
  "a3-output-themes.mjs|a3out.eigendeck||python3 $EXFIX/make_a3_output_deck.py dark \$DECKDIR/a3out.json; import_json \$DECKDIR/a3out.json"
  "a3-discard-reload.mjs|a3ov.eigendeck||python3 $EXFIX/make_overlay_deck.py single \$DECKDIR/a3ov.json; import_json \$DECKDIR/a3ov.json"
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
