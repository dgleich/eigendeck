# 2026-08-06 — #109 printable HTML: does the print layer break demos?

## What & why

David's release-bug pass reached #109 (printable HTML export: the interactive
`.html` export embeds a hidden `.eig-print-layer` so `File → Print` yields a clean
inch-based print view). He then worried: *"that printable HTML needs some fixes, I
think it breaks HTML output. We need more tests to make sure things like demos
still work with the [print] output."*

**Finding: #109 does NOT break the interactive export.** The print layer is
additive and correctly scoped. Verified three ways:

1. **Structural** (`e2e/export-print-demo-probe.mjs`, gated): a new `printdemo`
   fixture (live self-reporting demo + `html` element + notebook on one slide) —
   the three iframe surfaces the export's global `document.querySelectorAll('iframe')`
   sweep (font inject at exportCore.mjs:639, BroadcastChannel relay at :649) now
   touches. Asserts the screen layer keeps all live content, the demo srcdoc does
   NOT leak into the print layer, the `html` element renders as a print-layer
   iframe, and nav stays scoped to `#viewport`.
2. **Functional, synthetic** (`e2e/export-print-demo-browser.mjs`, chromium,
   standalone — NOT in the WebKitGTK gate): opens the export and proves the live
   demo actually boots + self-reports `DEMO-RAN` with the print layer present.
3. **Functional, real deck**: exported `examples/magnetic-powers.eigendeck` (45
   slides) and walked all slides in chromium — real demos mount + render, zero
   page errors.

The `html` element uses a script-less LOCKED sandbox by design (#137), so its
injected theme script is blocked in both the screen and print copies — a benign
"Blocked script execution in about:srcdoc" console line, not a break.

**Root cause of David's "broken" export**: his `gitignore/magnetic-matrix-powers-test.html`
had NO `eig-screen/print-layer` at all — it was exported from a STALE seam build
(a branch without #109). The `dist/` must be rebuilt with
`VITE_EIGENDECK_SEAM=1 npm run build` on the #109 branch or the seam export runs
old code. This is the same branch/stale-build trap that caused the earlier "print
broken again" false alarm.

## Branch state

Everything landed on **`main` = `c84e60b`** (pushed 2026-08-06):
- #109 printable HTML export (print layer),
- Snapshot commands (Generate Missing / Refresh All),
- #174 print title-wrap fix (letter-spacing/word-spacing px → in),
- "Export to HTML…" menu ellipsis,
- footer-probe scoped per-layer (#109 print layer has its own footer).

Gate before merge: full unit suite 1509 passed; full e2e 115/116 with the one
failure (footer-probe double-count) fixed to count per-layer; cargo check clean.
#109 and #174 CLOSED on GitHub.

## Final verification (2026-08-07)

A subagent hammered the export in **both WebKit and Chromium** across three real
decks (magnetic-powers 45, graph-explorer 4, showcase 16). All PASS: screen+print
layers present, `#viewport` slide count == deck (never 2×, no "90 slides"
regression), demos genuinely LIVE (interactive UI works, zero pageerrors), print
slide counts match, the tracked title renders 1 line (letter-spacing 2.112px, not
3.84px), and `@page { size: letter landscape }` yields 792×612 landscape PDFs in
chromium. Benign nuance: demo-*piece* decks show one ~0.7px hidden source iframe
per demo slide (pre-existing, unrelated to #109).

**Landscape default:** the export already emits `@page { size: letter landscape;
margin: 0; }`. Chrome/Edge/Firefox honor it (default landscape); Safari/WebKit
ignores `@page` orientation (long-standing) so it defaults to portrait — no
reliable pure-CSS fix. The PDF (Screenshots) export rasterizes to a landscape
canvas directly, so it is landscape regardless of browser.

## Deferred, now FILED as release-tagged issues (fix next)

1. **#175** — PDF export leaks the overflow "⋯" badge (`.text-overflow-badge`).
   Likely fix: `.pdf-capturing .text-overflow-badge { display:none }` near
   App.css ~2149 (the `.pdf-capturing` chrome-hiding block). Needs a repro test.
2. **#176** — PDF export should use the fade / step-through-with-counter UX like
   the snapshot commands (unify `printToPdf` onto the snapshot capture pass).
