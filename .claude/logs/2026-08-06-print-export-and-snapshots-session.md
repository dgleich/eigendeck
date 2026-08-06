# 2026-08-05→06 — Printable HTML export (#109) + snapshot commands + release-bug triage

Continuation of the copy/paste / release-bug arc. Everything below is on feature
branches; **main is `f50751d`** (has the copy/paste redesign, Cmd+A #173,
paste-file #160, all merged earlier). v26.7.23 shipped as a beta pre-release.

## TWO in-flight feature branches (NOT merged to main)

### `feat/printable-html-export` @ `e8109ec` — #109 (print layer)
Goal (David's words): a posted `.html` should be viewable AND printable — File→Print
in a browser gives the same output as the standalone "Export Printable HTML".
- The interactive export now embeds a **print layer**: a hidden `.eig-print-layer`
  of inch-based `.slide` divs (from `buildPrintSlideHtml`), behind `@media print`,
  while the interactive content is wrapped in `.eig-screen-layer`. On print the
  screen layer hides + print layer shows (`@page` letter-landscape). Fonts embed
  once, shared.
- Minimal/reuse design: NEW `src/lib/printLayer.ts` `preparePrintLayer()` EXTRACTED
  from `printToPdf` (which shrank 187→46 lines — one print path now). `printSlideHtml.ts`
  gained `printPageCss(scope)` + `exportPrintCss()`. `exportCore.mjs` gained two
  options (`printSlideHtmls`, `printCss`) — the callers (`fileOps.ts` GUI,
  `export-cli.ts`) build the print strings (exportCore is pure JS, can't import TS)
  and pass them in the existing options bag.
- **GUI/export uses `liveCapture:false`** (cached previews, no slide-flipping on
  export); the dedicated **Print export keeps the live flip-through**. → uncached
  demos print as PLACEHOLDERS from the HTML export (this is what the snapshot
  commands below fix).
- **Bug found + fixed (the "90 slides" one):** exportCore's interactive `.slide`
  CSS + nav JS were GLOBAL, so the print-layer `.slide` copies doubled the nav
  count (45-slide deck → "90") and the base `.slide{display:none}` would have
  blanked the print slides. Fixed by scoping to `#viewport .slide` (commit e8109ec).
- Verified in the rig: `export-print-layer-probe` (both layers, @page, `#viewport`
  = deck-count not 2x; magnetic-powers → 45 not 90). `exportCore.test.mjs` print-layer
  structure tests. **David has NOT re-confirmed the actual Mac Cmd+P print** since
  the 90-slide fix.

### `feat/snapshot-commands` @ `04c2729` — File-menu snapshot commands
- Two File-menu items (in the group with Presentation Settings + Compact):
  **"Generate Missing Snapshots"** (`generate-snapshots`) + **"Refresh All
  Snapshots"** (`refresh-snapshots`). Fix the export/print placeholder pain:
  render every live element (demo/notebook/video) to a persistent snapshot.
- `src/lib/snapshotAll.ts` `captureAllSnapshots(presentation,{force,onProgress})`:
  visits slides so each element's OWN capture effect fires (reuses the exact
  per-type args), persisting via `capturePreview`. `clearPreview(key)` added to
  previewCache (forget session hash + `db_clear_asset_cache`) for the force path.
  Menu-event handler `runSnapshots` in App.tsx drives it with a busy overlay
  showing "…(slide X of N)". Seam gains `captureSnapshots(force)` for e2e.
- **Idempotency bug (David hit it) — FIXED (04c2729):** it visited every slide
  every run. Now `needsCapture()` pre-checks (missing current-theme preview OR
  theme-stale) and only visits slides with a gap → 2nd run is a no-op ("All
  snapshots are already up to date"). Returns `{slidesVisited, captured, totalLive}`.
- Verified: `snapshot-command-probe` — clear a demo-piece preview → run 1 captures
  1/3 (only the missing one) → run 2 captures 0, visits 0 (idempotent). Real WebKit.

## THE IMMEDIATE BLOCKER (what David is stuck on)
David is testing on `feat/snapshot-commands` (branched off main, **no #109**), so his
export (`gitignore/magnetic-matrix-powers-test.html`, Aug 6 01:10) has NO print layer
(0 `eig-print-layer`/`eig-screen-layer`/`@page`, old bare `querySelectorAll('.slide')`)
→ "print is broken again." **Not a regression** — that branch never had #109.
**PENDING David's choice** (asked, not answered): (a) merge `feat/printable-html-export`
INTO `feat/snapshot-commands` so one branch has both, or (b) merge #109 to main first
then rebase snapshots. Either gives one build with print layer + snapshotted demos.

## DEFERRED release bugs (David: DON'T fix yet — tag as release, add a replicating
## test, fix AFTER #109 + snapshots land). NOT filed yet, NOT tested yet.
1. **Overflow "⋯" badge leaks into the PDF export.** It's the "Export to PDF
   (Screenshots)" path (`exportPdfScreenshots`, App.tsx:172) which screenshots the
   editor DOM under `document.body.classList.add('pdf-capturing')`. The
   `.pdf-capturing` rule (**App.css:2149-2162**) hides el-delete/resize/link-badges/
   demo-overlay/lock/toolbar/footer-meta/number — but **NOT `.text-overflow-badge`**
   (the amber #f59e0b "⋯", rendered SlideElementRenderer.tsx:914-932). FIX (later):
   add `.pdf-capturing .text-overflow-badge` to that display:none list. TEST: a deck
   with overflowing text, assert the badge is hidden during capture.
2. **PDF export should use the fade/step-through-with-counter UX** like Generate
   Missing Snapshots (busy overlay + "slide X of N"). `printToPdf` currently does a
   bare flip-through with a pre-message, no counter. FIX (later): unify printToPdf's
   flip-through onto `captureAllSnapshots` (persistent) + the busy-overlay progress —
   this is the "unify Print onto the snapshot path" cleanup.

## Other open release-labeled issues (GitHub)
- #160 paste-file, #173 Cmd+A — DONE on main, awaiting David's Mac confirm.
- #109 — in progress (this session).
- Untouched: #151 (doc proxy icon), #63 (macOS watcher warnings), #115 (thumbnail
  perf), #109-adjacent, #137 (SPEC audit).
- Filed/deferred: #172 (video interop), #167 (cross-deck asset bytes), #166
  (clipboard corpus), #168 (native Paste-as popup), #169 (html-element deck font).

## Environment note
Container reset mid-session; the e2e rig was re-provisioned (rustup + apt +
tauri-driver + app build at /tmp/el-target). If reset again, re-provision per the
eigendeck-e2e skill. Seam builds need `VITE_EIGENDECK_SEAM=1 npm run build`.
