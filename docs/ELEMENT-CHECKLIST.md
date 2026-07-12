# Element change checklist — what to touch, how to verify

> When you add an element **type**, or add/change a **property** on an existing
> type, use these checklists so the change lands in **every** render and output
> mode. This is the human-facing companion to the `editing-slide-elements`
> agent skill (`.claude/skills/editing-slide-elements/`); keep the two in sync.

## The core trap: there is no single element renderer

Eigendeck renders elements in **7 independent code paths, each with its own
`switch (el.type)`**. They share only a handful of sub-helpers. A property you
add in one path is **silently dropped** by the other six unless you propagate it.

This is the #98 bug class: arrow `heads`/`opacity` shipped correct in the editor,
present, and HTML export but **wrong in PDF/print, the link overlay, and
thumbnails** because those three hand-rolled arrow geometry and never got the new
fields. WYSIWYG only holds if a deck looks identical in every path — so check
every path.

## The 7 render / output modes

| # | Mode | File → function | Dispatch |
|---|------|-----------------|----------|
| 1 | **Editor canvas** (interactive) | `src/components/SlideElementRenderer.tsx` → `SlideElementRenderer()` | own `switch` |
| 2 | **Present / projector** (live + 2nd monitor) | `src/components/PresentSlide.tsx` → `PresentElement()` | own `switch` |
| 3 | **Present-mode wrapper** (transitions/animation) | `src/components/PresentMode.tsx` (`AnimatedArrow`, `getElementBounds`) | wraps #2; special-cases animating types |
| 4 | **HTML export** (app GUI + CLI + debug — 3 callers) | `src/lib/exportCore.mjs` → `buildExportHtml()` | own `switch` |
| 5 | **PDF / "Export for Print"** | `src/lib/printSlideHtml.ts` → `buildPrintSlideHtml()` (called by `App.tsx` `printToPdf()`) | own `if/else` |
| 6 | **Link overlay** (pick a link target) | `src/components/LinkOverlay.tsx` → `LinkableElement()` | own `switch` |
| 7 | **Thumbnail / static snapshot** (sidebar + speaker view) | `src/components/SlideThumbnail.tsx` → `ThumbElement()` | own `switch` |

Notes:
- Path **#3** only needs attention if the type **animates** (today only `arrow`
  interpolates — endpoints and Bézier control points).
- `App.tsx` also has `exportPdfScreenshots()`, a *screenshot* PDF that captures
  path #1's DOM, so it needs **no** per-type code. `printToPdf()` →
  `buildPrintSlideHtml()` is the one that hand-rolls HTML.
- Paths **#5, #6, #7** are the usual stragglers — they render simplified visuals
  and lag new properties. **Decide explicitly** whether each new property belongs
  in each.

## Shared sub-renderers — use these, don't re-derive

- **`src/lib/elementDescriptor.mjs`** — `describeArrow()`, `describeCover()`,
  `imageVisuals()`: resolve a raw element into `{geo, color, …}` once. Owns the
  canonical defaults so a color-omitted arrow can't render differently per target.
- **`src/lib/arrowGeometry.mjs`** — `arrowGeometry()`, `arrowSvgInner()` (SVG
  string), `triPoints()`, `arrowBBox()`. The inset line / cubic path + head
  triangles. Used by #1–#5 via the descriptor; route #6/#7 through it too.
- **`src/lib/elementHtml.mjs`** — `arrowSvgHtml()`, `coverHtml()`, `imageHtml()`:
  SVG/HTML-string builders shared by HTML export (#4) and PDF/print (#5).
- **`src/components/ArrowGlyph.tsx`** — the React `<g>` for an arrow (line/path +
  heads). Shared by editor (#1), present (#2), link overlay (#6), thumbnail (#7).
- **`src/components/TextElementSvg.tsx`** — the shared text+math renderer
  (`buildTextElementSvgMarkup` / `TextElementSvg`). Any text property that changes
  the *inner* text (font, valign, effect, padding) belongs here.
- **`src/types/presentation.ts`** CSS helpers — `textBackgroundCss`,
  `textEffectCss`/`textShadowCss`, `textBoxShadowCss`, `textPaddingCss`,
  `effectiveFontSize`, … Add a new text visual style as a helper here.

### The `exportCore.mjs` caveat (paths #4 and #5)

`exportCore.mjs` is **pure JS shared with the CLI** and **cannot import the TS
`presentation.ts`.** It keeps **hand-copied mirrors** (`TEXT_PRESET_STYLES`,
`textBgCss`, `THEME_BACKGROUNDS`, …). A new text-style property must be mirrored
here too, or HTML export diverges from the editor.

**HTML export (#4) has THREE callers** wired via an options bag — a capability you
add to `exportCore` must be wired in **both** `src/store/fileOps.ts`
(`buildPresentationExportHtml`) **and** `src/export-cli.ts` (and decide about
`src/debug/batchExportHtml.ts`). This is the #85 bug class (the CLI omitting a
callback the app passed). Grep every `buildExportHtml(` caller when you change the
contract.

---

## Checklist A — adding a NEW property to an existing type

- [ ] **Data model** — add the optional field to the interface in
      `src/types/presentation.ts`. If it's a text/visual style, add a shared CSS
      helper here.
- [ ] **Descriptor** — if the property affects arrow/cover/image geometry or
      resolved style, thread it through the matching `describe*()` in
      `elementDescriptor.mjs` (+ `.d.mts`) so all descriptor-driven paths get it
      for free.
- [ ] **Walk all 7 render modes** and decide per mode (see table). Remember:
      `exportCore.mjs` needs the logic **mirrored**; text inner-rendering goes in
      `TextElementSvg.tsx`; #5/#6/#7 commonly lag — fix or consciously skip.
- [ ] **exportCore option (if any)** — if the property needs a new callback/
      resolver (not just an `el` field the switch reads), wire it in **both**
      `fileOps.ts` and `export-cli.ts`.
- [ ] **Inspector** — add a control in the matching `selectedEl.type ===` block
      in `src/components/PropertiesPanel.tsx`.
- [ ] **Sanitizer** — ONLY if it's an authorable inline text-HTML style: add to
      `ALLOWED_STYLE_PROPS`/`ALLOWED_TAGS` in `src/lib/sanitizeRichText.ts`, else
      it's stripped on load/import.
- [ ] **Store geometry** — if the property is raw geometry on a `position`-less
      type (like arrow's `x1`/`c1x`), handle it in `store/presentation.ts`
      `moveElementsBy`, resync geometry-copy, and link-delta helpers.
- [ ] **Persistence** — a plain field rides the generic JSON `data` blob (no work).
      A **promoted column** (a new top-level asset id) must be stripped in the
      flush AND added on the Rust side (`src-tauri/src/storage.rs`).
- [ ] **Docs** — `docs/LLM-EDITING.md` + `docs/SPEC.md` bullet.
- [ ] **Tests** — Checklist C below.

Store sync and clipboard usually need nothing: `updateElement` propagates every
non-identity key to synced peers, and copy carries everything except
`detachedFields`.

## Checklist B — adding a NEW element type

- [ ] **Data model** — add the interface; add it to the `SlideElement` union; add
      a factory if it needs default geometry/values (`src/types/presentation.ts`).
- [ ] **All 7 render switches** — add a `case`/branch to #1–#7 (skip #3 unless it
      animates). A missing case renders nothing or hits `default: return null`.
- [ ] **HTML export wiring** — the exportCore switch (#4) serves all THREE
      callers; if the type needs caller-specific wiring (a preview PNG, a special
      renderer), wire it in **both** `fileOps.ts` and `export-cli.ts`.
- [ ] **Insert UX** — `App.tsx` `runInsert` switch + toolbar entry;
      `SlideEditor.tsx` add-element context menu; selection/marquee.
- [ ] **Inspector** — a `selectedEl.type === '...'` block in
      `PropertiesPanel.tsx`. Check `alignableEls` (excludes `arrow`).
- [ ] **Transitions** — `presentTransition.ts` only if the type should never fade
      (mask-like, as `cover` is).
- [ ] **Assets** (if it references one) — `assetUsage.ts` `isAssetBearing`;
      `fileOps.ts` `assetId`→`el.src`/`demoSrc` hydration + `getElementPreviewDataUrl`
      if it needs a baked preview; `App.tsx` `isLiveElement` if baked as a
      screenshot in print.
- [ ] **Lifecycle** — `elementLifecycle.ts` (`onFree/onResync/onMerge/onCopy`) if
      it carries cross-slide/duplicate instance state (as `notebook` does).
- [ ] **Clipboard** — `elementClipboard.ts` `isCopyableAsset` if it's an
      asset-bearing type that should copy cross-deck.
- [ ] **Store geometry** — if it has **no `position`** (raw coords like `arrow`),
      special-case it in `moveElementsBy`, `moveElementZ`, free/resync geometry,
      and link-delta helpers in `store/presentation.ts`.
- [ ] **Persistence** — flush (`addElementRow`) strips promoted columns from JSON
      `data`; a new promoted column also needs the Rust schema/migration
      (`src-tauri/src/storage.rs`). `el.type` persists as `elementType`.
- [ ] **Docs** — a section in `docs/LLM-EDITING.md` and `docs/SPEC.md`.
- [ ] **Tests** — Checklist C below.

## Checklist C — verify across every output & display mode

A green editor is **not** proof the export/print/thumbnail is green. Add a test
per applicable mode, then eyeball the visual paths.

- [ ] **Shared geometry/helper unit test** — `src/lib/*.test.mjs` (e.g.
      `arrowGeometry.test.mjs`, `exportCore.test.mjs`). Add a case for the new
      type/property.
- [ ] **Per-render-mode assertion** — each mode has a `@simplify-guard` render
      test; add a focused case asserting the new type/property appears:
      - #1 `SlideElementRenderer.test.tsx`
      - #2 `PresentSlide.test.tsx`
      - #3 `PresentMode.arrow.test.tsx` (only if it animates)
      - #4 `exportCore.test.mjs`
      - #5 `printSlideHtml.test.ts`
      - #6 `LinkOverlay.test.tsx`
      - #7 `SlideThumbnail.test.tsx`
- [ ] **Types + build** — `npx tsc --noEmit` and `npm run build` clean.
- [ ] **CLI export specifically** — the app export and CLI export wire
      `buildExportHtml` differently; test **both** (see `eigendeck-cli` skill).
      Seed the cache by opening the deck in the editor first (CLI math/previews
      come from cache).
- [ ] **Real-app e2e (visual)** — for anything visual, screenshot the editor AND
      present mode via the `eigendeck-e2e` rig and inspect the HTML export + PDF.
      Gate a probe in `e2e/run-all.sh` (see `arrow-spline-probe.mjs` for a
      template that asserts editor + present + export + inspector in one run).
- [ ] **If you skipped a straggler path (#5/#6/#7), say so** in the commit/PR —
      silent omission reads as "done everywhere."

## Known drift traps (verified; fix or call out, don't re-introduce)

- **Print (#5) genuinely diverges by design** for some defaults: it works in
  inches, the arrow default color is `#2563eb`, image shadow is a fixed 2px. Don't
  "unify" these onto the editor path without a behavior decision.
- **`assetUsage.ts` `isAssetBearing` omits `notebook` and `video`** even though
  both carry `assetId` — asset GC under-counts them.
- **Arrow default color is split** historically (`#2563eb` app/export vs `#e53e3e`
  present/overlay); `describeArrow` now owns the canonical `#2563eb` default, so
  route new code through it rather than hard-coding a color.
