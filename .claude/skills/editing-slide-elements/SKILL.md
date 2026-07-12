---
name: editing-slide-elements
description: This skill should be used when adding a new slide element type (text/image/arrow/demo/demo-piece/notebook/video/cover) OR adding/changing a property on an existing type (e.g. arrow `heads`/`opacity`, image `borderRadius`). Eigendeck has SEVEN independent render/output paths plus data, store, inspector, and doc concerns — a change applied to only the editor will silently render wrong (or vanish) in present mode, HTML export (app GUI AND headless CLI — wired separately), PDF/print, thumbnails, or the link overlay. This is the checklist of everything to update and how to verify WYSIWYG across all paths.
version: 0.1.0
---

# Editing Slide Elements

> Human-facing companion: `docs/ELEMENT-CHECKLIST.md` holds the same checklists in
> the repo docs. Keep the two in sync when the render paths change.

## When to use

Any time you touch the element data model or how an element looks:

- Adding a **new element type** to `SlideElement`.
- Adding or changing a **property** on an existing type (geometry, color,
  style, behavior).
- Investigating "the arrow/image looks right in the editor but wrong in the
  exported HTML / PDF / thumbnail."

## Why this exists — the core trap

**There is NO single element renderer.** Eigendeck renders elements in **7
independent code paths, each with its own `switch (el.type)`**. They share only
a few sub-helpers (`TextElementSvg` for text/math, `arrowGeometry.mjs` for arrow
math, the CSS helpers in `types/presentation.ts`). So a property you add in one
path is **silently dropped** by the other six unless you propagate it.

This is exactly how arrow `heads`/`opacity` (#98) shipped correct in the editor,
present, and HTML export but **wrong in PDF/print, the link overlay, and
thumbnails** — three paths hand-roll arrow math and never got the new fields.
The goal of WYSIWYG is that a deck looks identical in every path; that only holds
if you check every path.

## The 7 visual render/output paths

| # | Path | File → function | Per-type dispatch |
|---|------|-----------------|-------------------|
| 1 | **Editor canvas** (interactive) | `SlideElementRenderer.tsx` → `SlideElementRenderer()` | own `switch` |
| 2 | **Present / projector** (live + 2nd monitor) | `PresentSlide.tsx` → `PresentElement()` | own `switch` |
| 3 | **Present-mode wrapper** (transitions/animation) | `PresentMode.tsx` (`AnimatedArrow`, `getElementBounds`) | wraps #2; special-cases `arrow` |
| 4 | **Standalone HTML export** (app GUI + CLI + debug — 3 callers) | `exportCore.mjs` → `buildExportHtml()` | own `switch` |
| 5 | **PDF / "Export for Print"** | `App.tsx` → `printToPdf()` (`px2in`/`px2pt` loop) | own `if/else` |
| 6 | **Link overlay** (pick a link target) | `LinkOverlay.tsx` → `LinkableElement()` | own `switch` |
| 7 | **Thumbnail / static snapshot** | `SlideThumbnail.tsx` → `ThumbElement()` | own `switch` |

Notes:
- Path #3 only needs attention if the type **animates** (only `arrow`
  interpolates endpoints today).
- `App.tsx` also has `exportPdfScreenshots()` — a *screenshot* PDF that captures
  path #1's DOM, so it needs **no** per-type code. `printToPdf()` is the one that
  hand-rolls HTML.
- Paths #5, #6, #7 are the usual stragglers — they render simplified/placeholder
  visuals and frequently lag new properties. **Always decide explicitly** whether
  a new property should appear in each.

### Shared sub-renderers (use these; don't re-derive)

- **`src/lib/arrowGeometry.mjs`** — `arrowGeometry(x1,y1,x2,y2,headSize,heads)`,
  `triPoints(tri)`, `arrowBBox(...)`. Produces the inset line (so the stroke
  meets the head base, no poke-through) + head triangles, and clamps the inset
  on short arrows so they don't reverse. **Used by paths #1–#4.** **Hand-rolled
  (drift risk) in #5 PDF/print, #6 link overlay, #7 thumbnail.**
- **`src/components/TextElementSvg.tsx`** — `buildTextElementSvgMarkup` /
  `TextElementSvg`: the shared text+math renderer for paths #1, #2, #7, and
  export (via `makeTextElementRenderer`). Any text property that changes the
  *inner* text (font, valign, effect, padding) belongs here, not just in the
  wrappers.
- **`src/types/presentation.ts`** CSS helpers — `textBackgroundCss`,
  `textEffectCss`/`textShadowCss`, `textBoxShadowCss`, `textPaddingCss`,
  `textPresetBoxCss`, `effectiveFontSize`, `resolveNamedSize`. Add a new text
  visual style as a helper here so all paths stay consistent.

### The `exportCore.mjs` caveat

`exportCore.mjs` is **pure JS shared with the CLI** and **cannot import the TS
`presentation.ts`.** It keeps **hand-copied mirrors**: `TEXT_PRESET_STYLES`,
`textBgCss`, `textEffectCss`/`textShadowCss`/`textBoxShadowCss`/`textPaddingCss`,
`videoEmbedUrl`, `THEME_BACKGROUNDS`. A new text-style property must be mirrored
here too, or HTML export diverges from the editor. It also reads media by **path**
(`el.src`, `el.demoSrc`), which `fileOps` hydrates from `assetId` — not by
`assetId` directly.

### HTML export (path #4) has THREE callers — keep their wiring in sync

`buildExportHtml()` is the shared *renderer*, but it's driven by an **options
bag** (`renderMath`, `renderTextElement`, `renderNotebookElement`,
`getElementPreview`, `resolveFont`, `resolveMathBundle`, asset readers). Three
callers wire that bag **differently**:

| Caller | File | Context | Notable wiring |
|--------|------|---------|----------------|
| **App / GUI export** | `store/fileOps.ts` `buildPresentationExportHtml` | Full app, live webview | iframe-pool math (`makeTextElementRenderer`), `getElementPreviewDataUrl`, full-fidelity `renderNotebookElement` (`notebookExport`) |
| **CLI / headless export** | `export-cli.ts` `main()` | Hidden Tauri webview, no editor | cache-only math (`makeCachingRenderMath` → `math_cache` + singleton fallback), cache-only `getElementPreview`, `resolveMathBundle`/`resolveFont`; **does NOT wire `renderNotebookElement`** |
| **Debug batch** | `debug/batchExportHtml.ts` | Dev automation | minimal |

**This is the #85 bug class:** a capability you add to `exportCore` (a new option
the renderer consumes) must be wired in **fileOps AND export-cli** (and decide
about batch). #85 was exactly the CLI omitting the `getElementPreview` callback
that `fileOps` already passed, so PDF/notebook/video elements exported as
placeholders from the CLI only. When you change the exportCore options contract,
**grep every `buildExportHtml(` caller** and update each.

**CLI headless constraints** (why the wiring differs — don't "fix" by copying the
app wiring): the CLI has no iframe pool and no live asset pipeline, so it can't
render math or rasterize PDFs on demand. It relies on what the editor already
cached: math from the `math_cache` table (else a singleton-font fallback), and
preview PNGs from `asset_cache`. A deck never opened in the editor exports with
font-only math and placeholder previews. Notebooks in CLI export fall back to the
cached preview PNG (no `renderNotebookElement`), unlike the app's full srcdoc
iframe. The `eigendeck-cli` skill covers seeding the cache (open in editor first)
and the import/export round-trip; **use it to test CLI export**.

## Checklist: adding a NEW element type

Create a TodoWrite item per applicable line.

1. **Data model** — `types/presentation.ts`: add the interface; add it to the
   `SlideElement` union; add a factory if it needs default geometry/values
   (text uses `createTextElement`; arrow/cover/image are built inline at call
   sites).
2. **All 7 render switches** — add a `case`/branch to #1–#7 (skip #3 unless it
   animates). A missing case renders nothing or hits `default: return null`.
   The exportCore switch (#4) serves all THREE export callers; if the type
   needs caller-specific wiring (a preview PNG, a special renderer), wire it in
   **both `fileOps.ts` and `export-cli.ts`** (see "THREE callers" above).
3. **Insert UX** — `App.tsx` `runInsert` switch (the canonical "Add element"
   dispatch) + toolbar entry; `SlideEditor.tsx` add-element context menu;
   ensure selection/marquee works.
4. **Inspector** — `PropertiesPanel.tsx`: add a `selectedEl.type === '...'`
   editor block. Check `alignableEls` (excludes `arrow`).
5. **Transitions** — `presentTransition.ts`: only if the type should never fade
   (mask-like, as `cover` is forced static).
6. **Assets** (if it references an asset): `assetUsage.ts` `isAssetBearing`;
   `fileOps.ts` `assetId`→`el.src`/`demoSrc` hydration; `fileOps.ts`
   `getElementPreviewDataUrl` if it needs a baked preview in export/print;
   `App.tsx` `isLiveElement` if it's a "live" (iframe/video) type baked as a
   screenshot in print.
7. **Lifecycle** — `elementLifecycle.ts`: register `onFree/onResync/onMerge/
   onCopy` if it carries cross-slide/duplicate instance state (as `notebook`
   does).
8. **Clipboard** — `elementClipboard.ts` `isCopyableAsset` if it's an
   asset-bearing type that should copy cross-deck. (Plain props are carried
   automatically by the spread/`detachedFields` strip.)
9. **Store geometry** — `store/presentation.ts`: if it has **no `position`**
   and uses raw coordinates (like `arrow`'s x1/y1/x2/y2), special-case it in
   `moveElementsBy`, `moveElementZ`, `freeElement`/`resyncElement` geometry copy,
   and the link-delta helpers.
10. **Persistence** — `store/presentation.ts` flush (`addElementRow`) strips
    promoted columns from JSON `data`; `store/db.ts` is generic. A new
    **promoted column** (a new top-level asset id, etc.) must be stripped here
    AND added on the Rust side (`src-tauri/src/storage.rs` schema + migration).
    `el.type` persists as `elementType`.
11. **Docs** — add a section to `docs/LLM-EDITING.md` (authoring/JSON reference) and
    `docs/SPEC.md` (architecture/behavior).

## Checklist: adding a NEW property on an existing type

1. **Data model** — `types/presentation.ts`: add the optional field to the
   interface. If it's a text/visual style, add a shared CSS helper here.
2. **Every render path it should appear in** — walk #1–#7 and decide per path.
   Remember:
   - `exportCore.mjs` needs the logic **mirrored** (can't import TS).
   - Text inner-rendering changes go in `TextElementSvg.tsx`.
   - #5 print / #6 overlay / #7 thumbnail commonly lag — fix or consciously skip,
     don't forget.
   - If the property needs a new exportCore **option** (a callback/resolver,
     not just an `el` field the switch already reads), wire it in **both
     `fileOps.ts` and `export-cli.ts`** — the #85 bug class.
3. **Inspector** — `PropertiesPanel.tsx`: add a control in the matching
   `selectedEl.type ===` block.
4. **Sanitizer** — `sanitizeRichText.ts`: ONLY if it's an authorable inline
   **text-HTML** style — add to `ALLOWED_STYLE_PROPS` (or `ALLOWED_TAGS`) or it's
   stripped on load/import.
5. **Docs** — `docs/LLM-EDITING.md` + `docs/SPEC.md` bullet.

Store sync, clipboard, and persistence usually need **nothing** for a plain new
property: `updateElement` propagates every non-identity key to synced peers, and
copy carries everything except `detachedFields`.

## Known gaps (real, verified — fix or call out, don't re-introduce)

- **Arrow `heads`/`opacity`/`headSize` are dropped by paths #5 (PDF/print), #6
  (link overlay), and #7 (thumbnail).** #5 and #6 hand-roll a fixed end-only
  head with no inset; #7 (`SlideThumbnail.tsx` `case 'arrow'`) draws a bare
  `<line>` with **no arrowhead at all**. The fix is to route them through
  `arrowGeometry` + `triPoints` (SVG *string* in `printToPdf`, JSX elsewhere).
- **`assetUsage.ts` `isAssetBearing` omits `notebook` and `video`** even though
  both carry `assetId` — asset GC / usage counting under-counts them.
- **Default arrow color is split**: `#2563eb` (blue) in `App.tsx` / `exportCore`,
  `#e53e3e` (red) in `PresentSlide`/`LinkOverlay`/`SlideElementRenderer`. Never
  surfaces (real arrows carry an explicit `color`) but is a latent inconsistency.

## Verify before you call it done

- **Unit tests**: `npx vitest run` (geometry/export round-trips live in
  `src/lib/*.test.mjs` — e.g. `arrowGeometry.test.mjs`,
  `exportCore.test.mjs`). Add a case for the new type/property.
- **Types + build**: `npm run build` (tsc + vite) clean.
- **Visual across paths** — the only way to catch a lagging path. Math/text/SVG
  render in headless screenshots, so use the **eigendeck-e2e** rig (see that
  skill) to screenshot the editor AND present mode, and inspect the **HTML
  export** + **PDF/print** output. Eyeball the new type/property in each of the 7
  paths you intended it to appear in. A green editor is NOT proof the export is
  green.
- **CLI export specifically** — the app export and CLI export wire `buildExportHtml`
  differently, so test BOTH. Use the **eigendeck-cli** skill to export a deck
  headlessly and check the new type/property survived (seed the cache by opening
  the deck in the editor first; CLI math/previews come from cache). A green app
  export is NOT proof the CLI export is green — that was the #85 bug.
- If you fixed/skipped a straggler path (#5/#6/#7), say so explicitly in the
  commit/PR — silent omission reads as "done everywhere."
