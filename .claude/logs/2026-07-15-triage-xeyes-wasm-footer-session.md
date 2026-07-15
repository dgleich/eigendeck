# Shim merge, issue triage, xeyes, wasm demos, and the footer feature (07-15)

Follow-on to the YouTube-shim arc. Shipped the shim, did a big stale-issue
cleanup, added the xeyes examples, opened WebAssembly demos, and built the
deck-footer-font + per-slide-hide feature (#135).

## YouTube loopback shim — shipped + Mac-verified
The packaged-app YouTube fix (design in the prior log) landed: merged
`feat/youtube-embed-shim` to `main` and the user confirmed with a local
`npm run tauri build` that YouTube plays through the shim in the packaged app.
Closed #149 + #152. The app-wide CSP (review must-do #6) stays deferred to #122
(blob-demo CSP inheritance would break internet demos) — not required for the shim.

## Issue triage — 14 stale issues closed
Commits referenced issues as "(#NNN)" and merges were fast-forward, so nothing
auto-closed. Went through the open list with git/code evidence and closed what had
actually shipped: #152 #149 #150 #138 #132 #99 #133 #129 #112 #124 #90 #76 #127
(+ #145 earlier). Notables:
- **#129** (arrow Bézier splines) — genuinely done; `arrowGeometry.mjs` has c1/c2
  endpoint handles (my first "diverged" read was wrong).
- **#112** (notebook discard) — the "Discard Changes" action (5931cef) covers it.
- **#134** (present `/screenshot` hang) — the user thought it might be stale like
  the "2nd window" myth; I **tested it** and it's REAL (editor screenshot returns in
  1.6s, present-mode times out at 20s). Kept open + committed an executable repro
  (`e2e/present-screenshot-probe.mjs`, non-gated).
- Watched for false positives: several grep hits were "render path #3/#6" numbers,
  not issue refs.
Filed forward: **#154** (dark mode — split from the reverted #76 vibrancy),
**#155** (demo iframes swallow Space/←/→ in present, so slide nav is fiddly),
**#156** (common/master elements per slide — the footer is its prototype).

## xeyes examples (branch `examples/xeyes`)
Unix xeyes for slides, two forms:
- `examples-html-elements/xeyes.html` — NO-SCRIPT html element. Pure-CSS 3×3 hover
  grid; pupils glance toward the cursor only while it's over the eyes (no JS = no
  global cursor). The honest ceiling of a script-less html element.
- `example-demos/gimmicks/demos/xeyes.html` — a **two-piece** demo. A full-slide
  transparent `capture` piece broadcasts the cursor over BroadcastChannel; the
  `eyes` piece leans the pupils toward it, so the eyes track the cursor across the
  WHOLE slide. Verified headlessly (Chromium 2-iframe harness). Full-slide capture
  grabs slide pointer events → best on a dedicated eyes slide (ties to #155).

## WebAssembly demos — `'wasm-unsafe-eval'` (merged to main)
The injected demo CSP set `script-src 'unsafe-inline'`, which — script-src being
present — **blocked `WebAssembly.instantiate`**, so no Pyodide/GeoGebra/Emscripten
(Rust/Go/C→wasm) demo could run, including in exported decks. Verified in Chromium:
a bare wasm module throws `CompileError` without the token, runs with it. Added
`'wasm-unsafe-eval'` to the demo `script-src` (demoBridge.ts). It's the NARROW token
— wasm compile only, NOT JS `eval`/`new Function` (the dangerous `'unsafe-eval'`,
still never added); demos stay opaque-origin + connect-src-gated, so wasm can't
escape further than the JS already allowed. Updated the two `demoBridge.test.ts`
assertions + `CSP-AND-EGRESS.md`, `DEMO_AUTHORING.md` (new WebAssembly section:
embed the `.wasm` for offline or declare the CDN host; single-threaded only),
`DEMO-PLATFORM.md`. Merged to `main`. (Note for #122: a future app-wide script-src
must ALSO carry the token or blob-inherit re-clamps demo wasm.)

## Footer feature #135 (branch `feat/footer-font-omit`)
Deck-level footer font + per-slide hide, threaded through all FOUR footer render
paths (editor, present, HTML export, print/PDF) via a shared `src/lib/footer.mjs`
(`footerFontFamily` + `showFooter`) so they can't drift.
- `config.footerFont` (Deck-inspector picker), default **Lato** (the deck default
  text font — changed from PT Sans per review).
- `slide.omitFooter` → a plain **"Hide the footer"** checkbox in the Slide inspector
  (no section wrapper; #156 is the future "Common elements" home for it).
- Persistence needed the #85/#98 propagation: `omitFooter` added to BOTH the JS
  `slideMeta` and the Rust `build_slide_config_json` hardcoded key list (read-side
  splat already generic); `footerFont` rides the presentation config blob.
- Tests: `footer.test.mjs`, exportMatrix (export + print, present/absent/font),
  persistence field-record, and `e2e/footer-probe.mjs` (real-app editor/present/
  export; footerFont=Shantell so it's distinct from the Lato default). Docs updated.
Verified green (vitest, build, clippy, live footer probe). Merging to main pending
the full e2e gate.

## State at log time
`main` has the shim + wasm + #134 repro. Open branches: `feat/footer-font-omit`
(running its e2e gate before merge) and `examples/xeyes` (unmerged).
