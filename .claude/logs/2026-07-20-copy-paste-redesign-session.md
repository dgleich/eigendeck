# 2026-07-14→20 — Release polish, then the copy/paste architecture redesign

Long session. Two arcs: a batch of release-side fixes on `main`, then a ground-up
copy/paste redesign on `feat/copy-paste-redesign` (not merged).

## Release polish (merged to `main`)
- **#52** app icon: enlarged the stacked-screen motif in the squircle (`scale 1.7→2.2`),
  regenerated all `src-tauri/icons/*` (headless `tauri icon`, no Mac needed).
- **#164 / #161 first pass**: Unicode-safe + lossless re-importable HTML export;
  drag a non-demo `.html` onto a slide → falls back to a raw `html` element
  (`classifyDroppedHtml`); Demo toolbar button hidden by default (`defaultHidden`);
  paste plain/styled text → text element.
- **#163 + WOFF2**: showcase intro callouts sent behind the demo (per-element
  z-order in `build-showcase.mjs`); `subset-fonts.py` now subsets `data:font/woff2`
  (was ttf/otf only) preserving flavor via `opts.flavor` + brotli. Rebuilt + deployed
  the showcase to `eigendeck-web`; also regenerated + committed the manual pages.
- **DevTools**: View→Developer Tools now works in release (dropped a stray
  `#[cfg(debug_assertions)]`); then **compiled ALL debug tooling out of release**
  (`#[cfg(debug_assertions)]` on the `debug` module + menu + `DebugFlag` +
  `pasteboard_dump`) — release `clippy -D warnings` clean.
- **#151** doc/proxy icon: added an exported UTI (`dev.eigendeck.presentation`,
  chosen via research — nests under the app id like Keynote/PowerPoint, distinct
  from the app's canonical bundle id) with `UTTypeIconFile`; bound the doc type via
  `LSItemContentTypes`. Diagnosed the "one Mac shows the wrong icon" as a stale
  IconServices cache (the registration was correct), not a build problem.
- Filed **#165** (Add Slide inside a build inserts mid-sequence — reuse
  `duplicateSlide`'s group-walk).

## Copy/paste redesign — branch `feat/copy-paste-redesign`
Kicked off by a run of clipboard bugs found while testing #161 on the Mac
(styled Word text pasting as a PDF *image*; an Eigendeck copy pasting *black*; a
stale canvas paste serving an old element; ⌘V duplicating a slide; image copies
not linking). Root cause: **two clipboards** — an App-local `clipboardRef` buffer
separate from the OS clipboard — that desync.

Researched how Keynote/PowerPoint/Figma/Illustrator do it (agent, cited): **one OS
clipboard, many representations, private flavor read first, no separate buffer.**
Design doc: **`docs/copy-and-paste.md`** (model, per-type clipboard table, paste
ladder, styling rules, ⌘⇧V/Paste-as…, ⌘D-duplicate).

Done + e2e-verified on Linux (cross-platform; only the macOS native-pasteboard
*read* is Mac-specific):
- **Stage 1** — private-flavor codec (`clipboardModel.ts`: element/slide JSON base64
  in `text/html`), copy writes it, paste reads it first, **`clipboardRef` retired**.
  Kills the stale-paste / slide-duplicate desync by construction. `pasteInternalClip`
  (in `pasteClip.ts`) does the element paste + cross-slide link re-resolution.
- **HTML-element** copy now puts its source on the clipboard; **image** cross-slide
  link fixed (metadata rides in the Rust asset payload since arboard's image write
  clobbers the html private flavor).
- **Stage 2** — caret-vs-canvas: an edit-mode text-run copy → a new text box (was
  "nothing pastes").
- **Stage 3** — `normalizePastedStyles`: strip a WHOLE-STRING color (source default
  black) → theme; keep sub-range colors; drop underline (we have none), keep strike.

Tests: units for the codec, `pasteText`, the marker, and `pasteInternalClip`+linking
(store-level). e2e probes (gated): `internal-paste` (round-trip + stale guard +
link), `image-link`, `paste-text`. dgleich flagged 7 units as too thin for
copy/paste's bug density → building a comprehensive matrix next: round-trip +
color matrices, then an **interop corpus** (real Word/Slides/Keynote payloads as
fixtures + a reference table) + ingestion tests.

Remaining: Stage 4 (⌘⇧V "Keep Style" + "Paste as…" chooser), Stage 5 (⌘D duplicate
bypasses clipboard + proper slide-paste, ties to #165). Branch not merged.
