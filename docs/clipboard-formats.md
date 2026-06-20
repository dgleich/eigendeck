# Clipboard formats — what a copy puts where

> **Status: code-grounded reference** for the `fix/copy-paste-assets` branch.
> Every claim below is tied to a file and a line-ish location. If you change
> any of those sites, update this doc. The guiding rule: **the system
> clipboard is for other apps; in-app paste fidelity comes from a separate
> channel that never round-trips through the OS clipboard.**

Eigendeck's copy/paste spans three independent channels. A single Cmd/Ctrl+C
may write to one, two, or none of them depending on what is selected.

## The three channels

| Channel | Lives in | Scope | Purpose |
|---|---|---|---|
| **System clipboard** | the OS pasteboard (`arboard` / macOS `NSPasteboard`) | every app | so a copied text or image/SVG/PDF element pastes into Keynote, Word, browsers, etc. |
| **In-app `clipboardRef`** | a React `useRef` in `App.tsx` (per window) | one editor window | full-fidelity element/slide copy for paste back into the deck (sync/link aware) |
| **Internal clip** | a process-global `Mutex<Option<InternalClip>>` in Rust (`clip.rs`) | all windows in the process (cross-deck, cross-window) | round-trips an asset element *with its bytes* so cross-deck paste re-stores the asset into the destination deck |

### 1. System clipboard

Written **only on the `copy` DOM event**, never on the Cmd+C keydown — writing
on keydown races (and loses to) WebKit's own copy. The keydown handler
(`App.tsx:1069-1091`) only stages `clipboardRef`; `handleCopy`
(`App.tsx:1179-1202`) does the system write:

- **Text element** → `e.clipboardData.setData('text/html', …)` plus
  `text/plain` (`App.tsx:1189-1194`). The HTML is built synchronously by
  `textElementClipboardHtml` (`elementClipboard.ts:100-115`): a styled `<div>`
  with the element's font/size/weight/color, math pre-rendered via
  `renderMathInHtmlSync` into inline `<svg>`/`<foreignObject>`, and the
  eigendeck marker prepended.
- **Copyable asset** (`isCopyableAsset`, i.e. `type === 'image'` with an
  `assetId`) → `e.preventDefault()` then `copyAssetElement`
  (`App.tsx:1195-1197`), which calls the Rust `clip_copy_asset`. The actual OS
  pasteboard bytes are written by Rust (`clip.rs:57-77` → `build_reps` →
  `write_system`), so the bytes never cross into JS.
- **Anything else** (non-text non-asset element, multi-select, slide, empty
  selection) → no system write; `clearInternalClip` is called
  (`App.tsx:1185,1199`). The browser's default copy still runs (it copies the
  current DOM selection, usually nothing useful).

System asset representations are assembled by `build_reps`
(`clip.rs:153-171`):

| Source mime | UTIs put on the pasteboard |
|---|---|
| `application/pdf` | `com.adobe.pdf` (original bytes) **+** `public.png` (pdfium first-page raster, 1600×1200) |
| `image/svg+xml` | `public.svg-image` only (no Rust SVG rasterizer → no PNG companion) |
| `image/png` | `public.png` |
| other raster (jpg/gif/webp/…) | `public.png` (decoded/re-encoded via `to_png`) |

These reps reach the OS differently per platform (`write_system`,
`clip.rs:185-208`):
- **macOS** → `mac_write_multi` (`clip.rs:213-234`): one `clearContents()` then
  `setData_forType` per UTI, so a target app picks its preferred format (PDF or
  SVG into Keynote, PNG elsewhere).
- **Windows/Linux** → `arboard` sets the **single PNG** raster only
  (`clip.rs:195-205`). True multi-format is deferred. An SVG element therefore
  produces **nothing** on Windows/Linux (no `public.png` rep exists for SVG, so
  the `find(public.png)` misses).

### 2. In-app `clipboardRef`

A per-window ref (`App.tsx:558`) holding either
`{ type: 'elements', data, fromSlideIndex, fromSlideId }` or
`{ type: 'slide', data }`. Set on Cmd+C keydown for element / multi / slide
selections (`App.tsx:1073-1090`). Consumed by `handlePaste`
(`App.tsx:1125-1171`) **after** the internal-clip and system-image checks:

- `elements` → each element is deep-cloned with a fresh id; same-slide paste is
  an offset independent copy, cross-slide paste joins the source's sync group or
  links to it via `pasteElementDelta` (`App.tsx:1143-1164`, see
  `docs/sync-and-link.md`). `runCopyHook` carries type-specific state (e.g. a
  notebook recording).
- `slide` → `duplicateSlide` on the current index (`App.tsx:1168-1170`).

This channel is **window-local** (a plain ref) and is **not** serialized to the
OS, so it cannot cross windows or reach other apps.

### 3. Internal clip (cross-window, cross-deck)

A Rust process-global (`INTERNAL_CLIP`, `clip.rs:51`) holding the asset
**bytes**, the element JSON `payload`, the mime, and the OS clipboard
**generation** captured right after the copy (`clip.rs:22-33`). Written by
`clip_copy_asset` for copyable image/SVG/PDF elements only.

- **Staleness:** `clip_peek_internal` (`clip.rs:79-96`) compares the live
  clipboard generation to the stored one. On macOS the generation is
  `NSPasteboard.changeCount` (`clip.rs:128-145`); if it changed (a foreign app
  copied something after our copy), the internal clip is dropped so foreign
  content wins. On **Windows/Linux the generation is `-1`** (no cheap counter),
  so the internal clip is always treated **fresh** — the "copied in eigendeck,
  then copied elsewhere, then pasted" edge is macOS-correct only.
- **Paste:** `clip_paste_asset` (`clip.rs:101-114`) stores the bytes into the
  **current** deck via `store_asset_deduped` (content-hash dedup → repeated
  pastes reuse one asset) and returns a fresh `asset_id`. The frontend
  `pasteAssetElement` (`elementClipboard.ts:129-146`) rebuilds the element from
  the payload with a fresh `id` + `assetId` and **strips identity fields**
  (`id`, `assetId`, `syncId`, `_syncId`, `linkId`, `_linkId` via
  `detachedFields`, `elementClipboard.ts:38-42`) so a cross-deck paste never
  carries a stale sync/link id.

## Paste priority (who wins)

Three paste listeners fire on every `paste` event; order matters:

1. **`App.handlePaste`** (`App.tsx:1098-1172`): captures whether the system
   clipboard has an `image/*` *synchronously* (clipboardData is neutered after
   an await, `App.tsx:1103-1108`), then `await pasteAssetElement()`. A fresh
   internal asset wins over everything (`App.tsx:1113-1122`). If a foreign
   system image is present it returns to let `SlideEditor` handle it
   (`App.tsx:1124`). Otherwise it falls back to `clipboardRef`.
2. **`SlideEditor.handlePaste`** (`SlideEditor.tsx:58-231`): bails immediately
   if `hasFreshInternalAsset()` is true (`SlideEditor.tsx:66`) — this is the
   fix for the double-paste where the same asset arrived via both the internal
   clip and the system image. Otherwise it reads the **native NSPasteboard**
   first (vendor UTIs WebKit hides: `com.microsoft.image-svg-xml`,
   `com.adobe.pdf`; priority SVG > PDF > raster, `SlideEditor.tsx:82-116`), then
   the sync DataTransfer (`SlideEditor.tsx:141-157`), then the async Clipboard
   API for vector formats (`SlideEditor.tsx:164-189`), then a **rich-HTML → PNG
   screenshot** route for tables/formatted blocks — explicitly skipped when the
   HTML carries the eigendeck marker (`SlideEditor.tsx:198`,
   `!hasEigendeckMarker(htmlEarly)`).
3. **Text-selection paste** while editing a text box is handled by the
   contentEditable `onPaste` (`SlideElementRenderer.tsx:735-752`), which fires
   only inside the box; both window-level handlers bail when the target is
   `[contenteditable="true"]` (`App.tsx:1099`, `SlideEditor.tsx:60`).

## The eigendeck marker

`EIGENDECK_PASTE_MARKER = '<!--eigendeck-copy:v1-->'`
(`clipboard.ts:23`) — an HTML comment (invisible in render, survives WebKit
sanitization) prepended to any eigendeck-origin `text/html`. Producers:
`textElementClipboardHtml` (`elementClipboard.ts:114`), the text-selection
`onCopy` (`SlideElementRenderer.tsx:732`), and HTML/PDF export
(`App.tsx:124,355`). Consumers: the text-selection `onPaste` trusts marked HTML
and inserts it verbatim (stripping the marker), else falls back to `text/plain`
(`SlideElementRenderer.tsx:745-751`); `SlideEditor` uses its presence to *skip*
the rich-HTML→PNG route. The marker is what makes eigendeck→eigendeck text
formatting round-trip while rejecting Word/Pages styling.

## Copy matrix — what lands where

| Copied thing | System clipboard format(s) | In-app representation | Paste behavior |
|---|---|---|---|
| **Single text element** | `text/html` (styled div, math as inline SVG) + `text/plain` (`App.tsx:1189-1194`) | `clipboardRef` (`elements`) on keydown; internal clip **cleared** | In-app: independent copy / sync-or-link cross-slide. Other apps: styled text + plain text (math SVG is fragile — see gaps). |
| **Image element, kind=raster** | `public.png` (PNG; non-PNG re-encoded) | internal clip (bytes+payload) **+** `clipboardRef` | In-app & cross-deck: re-stored into dest deck, fresh id/assetId, deduped. Other apps: pastes PNG. |
| **Image element, kind=svg** | macOS: `public.svg-image`. Win/Linux: **nothing** | internal clip + `clipboardRef` | In-app/cross-deck: SVG bytes re-stored (vector preserved). Other apps: vector apps get SVG on macOS; nothing on Win/Linux. |
| **Image element, kind=pdf** | macOS: `com.adobe.pdf` + `public.png` (pdfium raster). Win/Linux: `public.png` only | internal clip + `clipboardRef` | In-app/cross-deck: PDF bytes re-stored. Other apps: Keynote/PDF apps get PDF (macOS); PNG fallback elsewhere. |
| **Demo** | none | `clipboardRef` only (internal clip cleared) | In-app only. Nothing to other apps. |
| **Demo-piece** | none | `clipboardRef` only | In-app only. |
| **Notebook** | none | `clipboardRef` only (`runCopyHook` clones recording state) | In-app only. |
| **Video** (file or embed) | **none** — see gap (video has an `assetId` but `isCopyableAsset` is image-only) | `clipboardRef` only | In-app only; even file videos do **not** reach the system clipboard or internal clip. |
| **Cover** | none | `clipboardRef` only | In-app only. |
| **Arrow** | none | `clipboardRef` only | In-app only (paste offsets x1/y1/x2/y2). |
| **Multi-select (N elements)** | **none** (internal clip cleared, `App.tsx:1086`) | `clipboardRef` (`elements` array) only | In-app only; per-element sync/link rules apply. No system write even if the selection contains images. |
| **Whole slide** | **none** (internal clip cleared, `App.tsx:1089`) | `clipboardRef` (`slide`) only | In-app only → `duplicateSlide`. |
| **Text SELECTION inside an editing text box** | `text/html` (marked, `range.cloneContents()` innerHTML) + `text/plain` (`SlideElementRenderer.tsx:732-733`) | none (handled entirely on the DOM event) | In-app: marked HTML re-inserted via `execCommand('insertHTML')`; unmarked external HTML downgraded to plain text. Other apps: HTML + plain text. |

## Known gaps & limitations (verified)

- **Text math doesn't survive into Keynote/PowerPoint.** The text HTML embeds
  math as inline `<svg>` inside `<foreignObject>`
  (`textElementClipboardHtml` → `renderMathInHtmlSync`,
  `elementClipboard.ts:108-110`). Keynote/PowerPoint ignore `foreignObject`, so
  math drops or renders blank; the surrounding styled text still pastes.
- **Windows/Linux assets are PNG-only.** `write_system` only sets the single
  `public.png` rep via `arboard` (`clip.rs:195-205`). SVG elements have **no**
  PNG companion in `build_reps` (`clip.rs:163`), so copying an SVG element on
  Windows/Linux puts **nothing** on the system clipboard. PDF copies fall back
  to the pdfium PNG.
- **Only single image/SVG/PDF elements reach the system clipboard** as assets.
  Text gets there as HTML. Everything else — demo, demo-piece, notebook,
  **video**, cover, arrow, multi-select, whole slide — uses
  `clipboardRef`/internal-clip only and pastes **nowhere** outside Eigendeck.
- **Paste dedupes assets by content hash** (`store_asset_deduped`,
  `clip.rs:112`): pasting the same image many times reuses one asset rather than
  piling up identical copies.
- **Cross-process staleness is macOS-only.** On Windows/Linux the clipboard
  generation is `-1` (`clip.rs:141-144`), so the internal clip is always treated
  fresh; a foreign copy after an eigendeck asset copy can be shadowed by the
  stale internal clip on those platforms.
- **PDF/SVG priority is SVG-first on paste-in.** When both SVG and PDF are on an
  incoming clipboard, SVG wins (`SlideEditor.tsx:88,136-139`) because PDF
  display landed later; the comments flag this as a deliberate, to-be-flipped
  ordering.

## Inconsistencies / bugs noticed while reading

- **Video file elements silently produce no system/internal clip.**
  `VideoElement` with `kind: 'file'` carries an `assetId`
  (`presentation.ts:447-448`), but `isCopyableAsset` gates on
  `el.type === 'image'` (`elementClipboard.ts:34-36`). So copying a file video
  hits the `else` branch in `handleCopy` and only clears the internal clip
  (`App.tsx:1198-1200`) — its bytes never reach the system clipboard or the
  cross-deck internal clip, unlike an image of the same asset. Likely
  intentional today, but it's a silent asymmetry worth a comment.
- **Multi-select containing images writes no asset to the system clipboard.**
  The multi-select keydown branch sets `clipboardRef` and calls
  `clearInternalClip` unconditionally (`App.tsx:1082-1086`); `handleCopy` only
  ever inspects `sel.type === 'element'` (single) (`App.tsx:1184`). So a
  multi-select of even a single image plus one other element loses the
  system-clipboard / cross-deck asset path that the same image gets when
  selected alone. Cross-deck multi-paste of images therefore breaks (the pasted
  elements reference assets that exist only in the source deck).
- **Two `paste` listeners both call `pasteAssetElement`/`hasFreshInternalAsset`
  on every paste**, each issuing a `clip_peek_internal` IPC round-trip
  (`App.tsx:1113`, `SlideEditor.tsx:66`). Correct (SlideEditor defers when
  App will handle it) but it's two IPC calls per paste; if peek had side
  effects this would be fragile. It does drop a stale clip on peek
  (`clip.rs:84-89`), so the *first* peek that finds it stale mutates state —
  benign here because both treat "stale → None" identically.
- **`copyAssetElement` mime fallback can mis-tag.** When asset metadata is
  missing it infers mime from `kind` only for `'svg'`, else defaults to
  `image/png` (`elementClipboard.ts:64`). A `kind: 'pdf'` element with no
  `meta.mime_type` would be copied as `image/png`, sending it down the raster
  branch of `build_reps` instead of the PDF branch. Relies on asset meta always
  being present for PDFs.
- **System write is best-effort and swallowed.** `clip_copy_asset` logs and
  continues if `write_system` fails (`clip.rs:68-69`), and `copyAssetElement`
  catches all errors returning `false` (`elementClipboard.ts:72-75`). A failed
  system write still populates the internal clip, so in-app paste works but the
  user gets nothing in other apps with no visible feedback.
