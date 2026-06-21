# Export / output architecture

Eigendeck has **four** ways a deck leaves the app. They exist for different
reasons and are deliberately NOT merged. The rule that keeps them from rotting:
**every element type must render in every code-based export path** (see the
contract at the bottom). Companion: `docs/export-review.md` (current audit /
bugs), `docs/presenter-architecture.md` (the on-screen rendering contexts).

## The paths

### A. Interactive HTML — the "best" output
- Entry: `exportPresentation` (`src/store/fileOps.ts`) → `buildExportHtml`
  (`src/lib/exportCore.mjs`). Also the CLI: `src/export-cli.ts` and the headless
  `tools/export-eigendeck.mjs`.
- Self-contained `.html`: **full interactivity** — live demos / demo-pieces as
  `srcdoc` iframes, nav bar, fonts embedded as data URLs.
- **Per-element code** — a `switch (el.type)` in `exportCore.mjs`. A type with no
  `case` is silently dropped.
- Text fork: when the caller passes `renderTextElement` (the app, via
  `makeTextElementRenderer`) each text box is a pre-rendered **SVG** (per-preset
  math fonts); the CLI path with no callback falls back to inline HTML divs
  (body-font math).

### B. Print HTML → PDF — vector output
- Entry: `printToPdf` (`src/App.tsx`). Writes a print-ready HTML doc; the user
  hits **Cmd+P → Save as PDF**, so the **browser** rasterizes — giving true
  **vector** text/paths (crisp, scalable), unlike a screenshot.
- Demos / videos / notebooks are baked in as **screenshots** of their live state
  (they can't be interactive in a PDF); text/arrows/covers are vector HTML.
- **Per-element code** — its own inline renderer (`App.tsx`, the `px2in` switch)
  AND a screenshot-collection pass that must include every "live" element type.

### C. Screenshot PDF — quick & dirty
- Entry: `exportPdfScreenshots` (`src/App.tsx`). Flips through slides,
  `modern-screenshot` captures the **live canvas** of each, assembles a `.pdf`.
- **No per-element code** — it photographs whatever is on screen, so it can never
  "drop" an element (it's the most robust, and the audit confirms it). The cost
  is raster output (not vector, not interactive).
- Candidate to deprecate in favor of B, but it's small and self-maintaining, so
  it stays for people who just want a PDF file in one click.

### D. `renderSlideForPrint` — DEAD, slated for removal
- `src/App.tsx`. The *original* print-HTML renderer (extracted in commit
  `c12bd8d` with 12 tests). Superseded by **B** (`printToPdf`), which added demo
  screenshots and inch units. It has **no runtime caller** — only
  `src/__tests__/print-export.test.ts`. It's a divergence trap (a third HTML
  renderer that silently differs). **Deprecate / remove.**

## Why not coalesce A/B/C
Different output media, not the same thing rendered three ways:
- A is **interactive** (live iframes) — wrong for a static PDF.
- B is **vector via the browser's print engine** — needs static screenshots of
  live elements, not iframes.
- C is **raster screenshots of the live canvas** — no markup generation at all.

So they share intent ("render a slide") but not mechanism. The leverage is the
**contract + an enforcement test**, not a merge.

## THE CONTRACT — adding a new element type is cross-cutting

A new element type MUST be handled everywhere it can appear, or it's silently
dropped from some output. Checklist for any new `SlideElement` type:

| Context | Site | Needed? |
|---|---|---|
| Editor | `SlideElementRenderer.tsx` (`switch`) | yes |
| Live present | `PresentSlide.tsx` (`PresentElement` `switch`) | yes |
| Static (sidebar/speaker) | `SlideThumbnail.tsx` (`ThumbElement` `switch`) | yes |
| **A. Interactive HTML** | `exportCore.mjs` (`switch (el.type)`) | **yes — per-element** |
| **B. Print HTML/PDF** | `printToPdf` render switch **+** screenshot-collection pass (`App.tsx`) | **yes — per-element** (live elements like notebook/demo/video need the screenshot pass) |
| C. Screenshot PDF | — | no (screenshots the live canvas automatically) |
| Export CLI | uses A (`exportCore.mjs`) | covered by A |

**Enforcement:** `src/lib/exportCore.test.ts` builds a deck containing one of
every element type and asserts `buildExportHtml` emits a rendering for each — so
a future type added without an A `case` fails CI. Keep its element list in sync
with the `SlideElement` union in `src/types/presentation.ts`. (B is harder to
unit-test headlessly because it leans on screenshots; the checklist + code review
guard it — and the audit's stress deck `test-presentations/export-stress.eigendeck`
exercises every type through all paths.)
