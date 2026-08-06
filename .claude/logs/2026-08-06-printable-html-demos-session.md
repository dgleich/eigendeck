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

- `main` = `b7449d0` — snapshot commands (Generate Missing / Refresh All Snapshots)
  merged + pushed.
- `feat/printable-html-export` = `630f972` — #109 + a merge of `main` (so it has
  BOTH #109 and the snapshot commands: snapshots bake demo/notebook/video previews
  that the print layer then shows instead of placeholders). Full unit suite green
  (1508 passed). Running the full e2e gate before merging to main.

## Deferred (David: "tag as release, add a repro test, fix AFTER these two")

NOT yet filed as issues, NOT yet fixed — do these only after #109 lands:
1. PDF export leaks the overflow "⋯" badge (`.text-overflow-badge`) into the
   output. Fix likely: add `.pdf-capturing .text-overflow-badge { display:none }`
   near App.css ~2149 (the `.pdf-capturing` chrome-hiding block).
2. PDF export should use the same fade / step-through-with-counter UX as the
   snapshot commands (unify `printToPdf` onto the snapshot capture pass).
