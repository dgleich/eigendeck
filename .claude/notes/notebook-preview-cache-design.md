# Cached PNG previews for notebooks (and later demos)

Design note — 2026-06. David's ask: store a cached PNG of a notebook's rendered
"contents" (like the demo static-PDF capture), but captured **proactively** on
a few events rather than by flipping through every slide at export time. One
cached asset per notebook. "We're going to use it for demos too" — so design it
generic from the start.

## Why
- **Static export** (PDF/print/HTML) currently captures demos by *flipping
  through every slide* at export time and `domToDataUrl`-ing each demo node
  (App.tsx ~230-260). Slow, and the live thing must be on-screen. A pre-captured
  cached PNG removes the flip-through: export just reads the cache.
- **Sidebar thumbnails / LinkOverlay picker** want a real picture of a notebook,
  not a blank box (LinkOverlay currently shows an "NB" placeholder).
- Notebooks render **offline** (cells display without a kernel), so a faithful
  capture is always possible in-editor.

## Storage — reuse `asset_cache`
Schema (storage.rs ~144): `asset_cache(source_id, variant, width, height, png
BLOB, source_hash, rendered_at)`, PK `(source_id, variant, width, height)`.
Already used for image/PDF downscale tiers (keyed by assetId, variant '_').

For previews:
- **source_id = the element's sync identity = `syncId ?? id`** (same key as the
  notebook overlay in useOverlay). Synced notebooks look identical → share ONE
  preview, consistent with sharing one overlay.
- **variant = `preview`** — namespaces preview entries away from the assetId-
  keyed downscale tiers (no collision even if an element id equalled an assetId).
  If theme matters, use `preview:<theme>`; v1 can ignore theme and recapture.
- **width/height = the captured pixel size** (the element's on-canvas px, or a
  fixed cap e.g. 1100-wide). ONE entry per element → "single cached asset".
  Overwrite on recapture (don't accumulate tiers — unlike images).
- **source_hash = hash of everything that changes the picture**: notebook
  source signature (`notebookSourceSignature`) + overlay signature
  (serializeOverlay) + display props (hideHeader, syntaxHighlight, hideMarkdown,
  showBorder, showLineNumbers, fontSize/fontSizeName, visibleCells) + theme +
  size. Skip recapture when the hash matches the cached `source_hash`.

### Backend gap
There is NO client-facing "store this PNG into asset_cache" command today —
`asset_cache` is written server-side by the downscale renderer
(`db_downscale_asset_cache`) and read via `db_get_asset_cache` /
`db_get_asset_cache_bytes`. **Add `db_put_asset_cache(source_id, variant, width,
height, png, source_hash)`** (upsert; replace any existing row for the PK).
Reads use the existing `db_get_asset_cache_bytes`. Invalidation can reuse
`db_clear_asset_cache(source_id)`.

## Capture mechanism
`modern-screenshot`'s `domToPng`/`domToDataUrl` on the element's DOM node,
located by the existing `[data-element-id="<id>"]` selector (same hook PDF
export uses). Convert dataURL → bytes → `db_put_asset_cache`. Capture at the
element's natural size (`el.position.width/height`), `scale: 1`.

Helper (new, generic): `captureElementPreview(elementId)` in e.g.
`src/lib/previewCache.ts`:
1. find `[data-element-id=id]`; bail if not mounted.
2. compute source_hash; if it matches the cached row's hash, skip.
3. `domToPng(node, {width,height})` → bytes → `db_put_asset_cache(syncId??id,
   'preview', w, h, bytes, hash)`.
Debounce (~300ms) and guard against concurrent captures per id (an inflight
map, like assetRenderer.ts:197).

## Triggers (per David)
1. **On add** a notebook — after first render (a tick / rAF).
2. **On edit properties** of a notebook — the PropertiesPanel changes
   (hideHeader, syntaxHighlight, fontSize, editable, kernel, …) → debounced
   recapture. Also after overlay changes (a cell edited / output recorded) since
   those change the picture — hook the overlay flush.
3. **On leave a slide** that contains a notebook — capture BEFORE navigating
   away, while still mounted (selectSlide is the seam; capture the outgoing
   slide's notebook nodes first, then switch).

Never capture in **present mode** (mode !== 'editor'); only the editor has the
authoring render and we don't want writes mid-presentation.

## Consumers — the POINT (David: "it represents the notebook element in other places, we just need an image of it")
The PRIMARY uses are places that show a lightweight stand-in for the element
instead of a live render:
- **Mini-slide (sidebar thumbnail)**, SlideSidebar.tsx — the thumbnail is a live
  mini-render (text→`TextElementSvg`, image→`SidebarImageThumb`, arrow→svg).
  Add a **`notebook` case → `<img>` of the cached preview**. (Demo gets the same
  later.) This is the main consumer.
- **Slide-preview selection (LinkOverlay picker)** — replace the "NB" box with
  the preview `<img>` so you can see which notebook you're linking to.
- (Secondary) static export PDF/print: read the cached preview instead of the
  flip-through live capture; fall back to live on a miss.

### Read path (size-robust)
asset_cache PK is `(source_id, variant, width, height)`, so a reader needs the
exact captured size. The element may be resized after capture, so don't assume a
size: `db_list_asset_cache_variants(key)` → find the `preview` row → fetch its
`(width,height)` via `db_get_asset_cache_bytes` (empty Response = miss) →
`URL.createObjectURL` a Blob. Memo the blob URL per key; invalidate when the
preview is (re)written. Helper: `loadPreviewUrl(key)` in previewCache.ts.

## Multi-phase elements need MULTIPLE previews (one per phase)

The `asset_cache` PK is `(source_id, variant, width, height)` — so there's room
for **many** previews per element, keyed by `variant`. v1 uses a single
`variant: 'preview'` (one picture per element). A **multi-phase demo** (e.g. a
demo-piece shown as different `piece`s across build slides, or a demo with N
internal states) needs **one screenshot per phase** → key by a phase-aware
variant: `variant = 'preview:' + <phaseKey>`.

- demo-piece phase key = `element.piece`; full-demo phases = a phase index/id.
- Notebooks are usually single-phase (synced instances share view), BUT a
  notebook whose per-build instances differ (e.g. different `visibleCells`)
  is ALSO multi-phase and would want `preview:<phaseKey>` per view.
- API change when we do this: `capturePreview(el, innerSelector, variant?)` and
  `loadPreviewUrl(key, variant?)` take the variant; `previewKey` stays the
  element's sync identity. Consumers (sidebar/picker) pass the phase they show.

So: not a capacity limit — just a keying choice. v1 ships one 'preview'; multi-
phase is a variant suffix away.

## Generalize to demos
Same `captureElementPreview` + `db_put_asset_cache`, keyed by `syncId ?? id`,
variant `preview`. Demos differ in two ways:
- Their picture depends on the live iframe state (interaction), so source_hash
  should fold in the demo asset hash + any saved demo-config/static-state
  (issue #59) rather than notebook source.
- Demos may need a settle delay before capture (the PDF path waits 500ms).
Keep the capture helper element-type-agnostic; compute source_hash via a small
per-type function (notebook vs demo), mirroring the elementLifecycle registry
pattern. This is the path to retiring the export-time flip-through for demos too.

## Edge cases / notes
- Element must be on-screen + rendered to capture. "On add" and "on leave"
  guarantee a mount; "edit properties" too. A freshly-opened deck has no preview
  until the user visits/edits — export should fall back to live capture (or do a
  one-time warm pass) when a preview is missing.
- One entry per element (overwrite) keeps it a "single cached asset" and bounds
  table growth; `db_gc_assets`/`db_clear_asset_cache` already prune.
- Synced notebooks share the preview (key `syncId ?? id`); freeing one makes it
  key by its own id → it gets its own preview on next capture. Consistent with
  the overlay model.

## Phased plan
1. Backend: `db_put_asset_cache` (+ register). Small.
2. `src/lib/previewCache.ts`: `captureElementPreview(id)` + source_hash for
   notebooks, debounce + inflight guard.
3. Wire triggers: add (App.tsx/SlideEditor insert), property-edit
   (PropertiesPanel / NotebookContent effect), leave-slide (store.selectSlide).
4. Consumer: static export reads cached notebook previews (fallback to live).
5. Generalize: demo source_hash + wire demo triggers; export reads demo previews.
6. Optional: LinkOverlay picker + sidebar thumbnail use the preview.
