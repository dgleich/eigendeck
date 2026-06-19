# HTML export: make it complete + losslessly re-importable

**Status:** planning. Backbone (self-contained JSON) is DONE; HTML side is not.
**Date:** 2026-06-03

## Goal (from David)

The exported HTML is for **publishing to his website**. Other people download it
and **import it back into a working `.eigendeck` and keep editing**. So the HTML
must be:

1. **Display-complete** — every element type renders statically in the browser:
   text, image, **svg**, **pdf**, **notebook**, demo, demo-piece, cover, arrow.
2. **Import-complete** — re-importing the HTML reconstructs the full deck,
   every asset type, exact bytes, original ids. ("undo everything in the HTML")
3. **Single-store** — do NOT embed each asset's bytes twice. Assets are big.
4. Notebook in HTML = **static view, no interactivity beyond scroll**. A
   scrollable rendered view of cells + recorded outputs. No run buttons, no
   editors, no kebab.

## What already exists (done this session)

- `db_export_json_with_assets` (storage.rs): presentation JSON + `assets[]`
  array, current version only, bytes base64. Carries path/mime/hash/
  externalPath/**ownerElementId** (notebook overlays) + data.
- `db_import_json` restores `assets[]` when present (authoritative: clears +
  restores under original ids). Malformed entry → whole import rejected.
- CLI `export json FILE --with-assets`; `import json` auto-restores.
- Lean `db_export_json` unchanged (normal load + LLM bulk-edit stay small).
- So: **the portable round-trip already works for JSON.** HTML must reuse it.

## Current HTML export state (the gaps)

`src/lib/exportCore.mjs` `buildExportHtml()` element switch handles:
- `text` → pre-rendered SVG (math composited, fonts resolved) ✅
- `image` → `<img src="data:...">` (data URL, **untagged**) ✅ display, ❌ import
- `demo` / `demo-piece` → `<iframe srcdoc>` (piece has bootstrap injected) ✅
- `cover`, `arrow` → inline divs/SVG ✅

**Missing entirely (no switch case): `svg`, `pdf`, `notebook`.** They don't
display on the website today and don't survive import.

Import side: `importFromHtml` (fileOps.ts) reads only the `eigendeck-source`
comment (structure-only `JSON.stringify(presentation)`, line ~306 of
exportCore) → `db_import_json` → **assets are lost**. The body's display data
URLs are never recovered.

Callers of `buildExportHtml` (all must keep working):
`src/store/fileOps.ts` (GUI export), `src/export-cli.ts` (CLI),
`src/debug/batchExportHtml.ts` (batch/test).

## Architecture decision: one embedded copy, used for both jobs

Embed the **complete self-contained deck JSON** (structure + `assets[]` with
base64) ONCE, in a single block:

```html
<script type="application/json" id="eigendeck-deck">{ ...db_export_json_with_assets... }</script>
```

- **Import:** `importFromHtml` reads `#eigendeck-deck` → `db_import_json`
  (already restores `assets[]`). Trivial + reliable. Replaces the old
  `<!-- eigendeck-source -->` structure-only comment.
- **Display:** slide body holds lightweight placeholders tagged by asset id
  (`<img data-asset-id>`, etc.). A small loader script paints them from the
  same `#eigendeck-deck` block on load. → exactly ONE copy of each asset's
  bytes (satisfies single-store).

Tradeoff: images paint via JS instead of raw `<img src=data:>`. Acceptable —
the deck is already JS-driven (nav, demos, slide visibility; no-JS already
shows only slide 1). Guard with a render test so live talks don't regress.

### Raw bytes (import) vs derived renders (display)

- `assets[]` carries **raw** bytes (ipynb, pdf, svg, png) — that's what import
  needs. asset_cache (derived) does NOT need to round-trip; it regenerates on
  open.
- Some types need a **derived render** to *display* statically:
  - **pdf** → page(s) rendered to PNG (pdfium → `asset_cache`, schema:
    `source_id, variant, width, height, png`). Embed the rendered PNG for the
    shown page; keep raw pdf bytes in `assets[]` for import.
  - **notebook** → rendered cell HTML (built at export time; see below).
- So the loader needs, per element: either an asset id (img/svg) OR a derived
  display payload (pdf png, notebook html). Put derived display payloads in the
  deck block too (display-only; not re-imported), OR generate inline in the
  body. **Decision: inline derived display in the body** (pdf png as data URL,
  notebook as rendered HTML) since they're display-only and per-element; keep
  `assets[]` purely raw for import. Avoids a second id-indexed map.
  - Note: this means pdf has raw bytes (deck block) + 1 page PNG (body) — that
    PNG is a *derived* render, not a duplicate of the raw pdf, so it's
    acceptable and small relative to the pdf.

## Per-type work

- **img**: body `<img data-asset-id>`; loader sets src from assets[] (mime+b64).
- **svg**: inline the SVG markup (it's text/xml) for crispness, OR data URL.
  Inline preferred. mime `image/svg+xml`. Check `assetRenderer.ts` for any
  rasterization we should bypass.
- **pdf**: embed the rendered page PNG (from asset_cache / pdfium) as the
  display image; raw pdf in assets[]. Need an export-time path to get the
  cached/rendered PNG for the element's current page. (User: "may need to
  export some of our cached assets/resources.")
- **notebook** (static, scroll-only):
  - parse .ipynb (`notebookParser.ts`) + merge overlay
    (`notebookOverlay.ts mergeNotebook`) → MergedCell[].
  - render: markdown cells → `marked` HTML; code cells → source with
    highlight.js (static, no CodeMirror) + outputs.
  - outputs (`CellOutput`): stream→`<pre>`, image/png|jpeg→`<img data:>`
    (overlay outputs already base64), text/html→inline, text/plain→`<pre>`,
    error→traceback `<pre>`.
  - honor element display opts: hideMarkdown, hideHeader, showBorder,
    fontSize/fontSizeName; theme colors from slide theme.
  - container: fixed element-sized `div` with `overflow:auto` (scroll only).
  - reuse logic from `components/notebook/CodeCell.tsx` / `CellOutput.tsx` but
    emit static HTML strings (no React, no handlers). Could factor a shared
    pure renderer used by both the live component and the exporter.
- **demo / demo-piece**: keep interactive iframe srcdoc (these ARE interactive;
  not "static"). Already work. Ensure demo bytes also ride in assets[] for
  import (currently body-only).
- **fonts**: already embedded as @font-face data URLs
  (`buildEmbeddedFontFacesCSS`). ✅
- **math**: pre-rendered to inline SVG per element; CDN fallback if unrendered.
  math_cache need not be embedded. ✅

## Phasing

- **A. Round-trip backbone:** embed `#eigendeck-deck` (with assets) + loader;
  move img/demo to id-placeholders painted by loader; rewrite `importFromHtml`
  to read the block. → import-complete for img/demo/svg; single-store. Add
  render test (exported deck visually identical) + round-trip test.
- **B. svg** display (inline).
- **C. pdf** display (embed page PNG; wire export of the cached/rendered page).
- **D. notebook** static render (cells + outputs, scroll-only). Largest piece;
  consider extracting a shared pure cell-renderer.
- **E. derived-resource export plumbing** (asset_cache PDF renders, anything
  else display needs). Make sure import ignores derived (regenerates).
- **F. tests:** round-trip every type (export HTML → import → bytes/ids match);
  visual regression for existing types; CLI `import html` (optional, see below).

## Open questions / decisions to confirm

- **Embed derived PDF renders vs pdf.js in-browser.** Recommend embed derived
  (offline, simple). Revisit if pdf size is a problem.
- **Static display of notebooks/PDFs is NEW** — today they don't show at all.
  Confirm scope includes display, not just import. (David: yes — wants display
  for everything.)
- **CLI `import html`?** Today CLI import is json-only; GUI has importFromHtml.
  Could add `import html` that strips `#eigendeck-deck` and reuses db_import_json.
  Optional.
- **Size:** self-contained HTML with all bytes will be large for media-heavy
  decks. That's inherent to "downloadable + re-importable." Single-store keeps
  it minimal. Consider gzip note for hosting.
- **Backward compat:** old exported HTML uses `<!-- eigendeck-source -->`
  (structure only). Keep importFromHtml able to read BOTH the old comment and
  the new `#eigendeck-deck` block.

## Key files

- `src/lib/exportCore.mjs` — buildExportHtml (display + embed). Core change.
- `src/store/fileOps.ts` — exportPresentation (GUI), importFromHtml.
- `src/export-cli.ts`, `src/debug/batchExportHtml.ts` — other export callers.
- `src-tauri/src/storage.rs` — db_export_json_with_assets, db_import_json
  (restore), asset_cache, pdfium render.
- `src/lib/notebookParser.ts`, `notebookOverlay.ts` (mergeNotebook),
  `components/notebook/{CodeCell,CellOutput}.tsx` — notebook render to reuse.
- `src/lib/assetRenderer.ts` — svg/asset rendering.
- `src/lib/fonts.ts` — font embedding (already done).
