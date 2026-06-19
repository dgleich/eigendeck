# Cross-app copy/paste of image & SVG elements — design + bugs (FLAGGED FOR LATER)

**Status:** NOT part of `fix/presenter-view`. Do this on `main` or a dedicated
branch. Captured 2026-06-19 while working on the presenter branch; deferred at
the user's request ("these aren't on the presenter branch, flag for later").

## The bugs (observed)

1. **Copy an image element → open a new presentation → can't paste it in.**
   The internal clipboard (`clipboardRef` in App.tsx) carries the element JSON
   (with its `assetId`) but NOT the asset BYTES. Pasting into a different deck
   creates an image element pointing at an `assetId` that doesn't exist in that
   deck → blank/broken image.
   - Evidence: `gitignore/test-3.eigendeck` after a cross-deck paste has TWO
     image elements (`76cf8f7f`, `407ab60d`) both referencing missing asset
     `651d9ffd`.

2. **Double paste** — one paste produced two elements. User says this is
   "something else" (separate from the asset issue). Investigate independently:
   likely both the App.tsx internal `handlePaste` AND SlideEditor's image/HTML
   `handlePaste` firing for the same event. Coordinate the two window-level
   `paste` listeners (one should defer when the other handles it).

3. **Synced element pasted cross-presentation comes in "synced" but isn't.**
   `pasteElementDelta(el, sameSlide)` only distinguishes same-slide vs
   cross-slide WITHIN one deck. Crossing INTO a different presentation should
   force an independent copy (detach sync/link identity). Track the source
   presentation id in the clipboard payload; if it differs from the current
   deck, use `detachDelta()`.

## Desired design (from the user)

**Copy should put the ACTUAL asset on the system clipboard in its native
format**, so it can be pasted into other apps too — not just an eigendeck
reference:
- raster image element → PNG (or original raster) image on the clipboard
- SVG element → SVG on the clipboard

**Embed eigendeck metadata** alongside so pasting back into eigendeck restores
the full element (preset/size/rotation/etc.), e.g. a custom `com.eigendeck.element`
pasteboard type carrying the element JSON. Paste-back checks for it first to
restore attributes; absent it, falls back to a plain image insert.

Because paste-back then goes through the EXISTING image/SVG paste path
(SlideEditor), the bytes get stored as an asset **in the destination deck** —
which is exactly what fixes bug #1 (and makes it work across windows, since the
system clipboard is shared, unlike the per-window `clipboardRef`).

## Implementation pointers

- **Copy** (App.tsx, keydown `Cmd+C` handler, ~line 1068): currently only sets
  `clipboardRef`. Add a native clipboard WRITE for asset-backed elements.
- **Native pasteboard**: `src-tauri/src/pasteboard.rs` has READ commands only
  (`pasteboard_list_types`, `pasteboard_read_type`, +drag variants). Need a
  WRITE command (macOS NSPasteboard `setData:forType:` for `public.png` /
  `public.svg-image` + a custom `com.eigendeck.element` type). macOS first;
  Windows/Linux later. New capability entry likely needed.
- **Asset bytes**: `db_get_asset_bytes_by_id(asset_id)` (storage.rs:2204) to
  fetch the bytes to write to the clipboard.
- **SVG vs raster**: `element.kind` (`'raster' | 'svg' | ...`) selects the UTI.
- **Paste-back path already handles** native SVG/PDF/raster: SlideEditor.tsx
  `NATIVE_PREFER` / `PREFERRED_FORMATS` (`public.svg-image`,
  `com.microsoft.image-svg-xml`, `image/svg+xml`, PNG). So once copy writes the
  asset, paste-back into a new deck already works — the metadata layer is what
  restores eigendeck attributes.

## Gotchas
- Clipboard image write in Tauri WebKit: `navigator.clipboard.write` with image
  ClipboardItems is unreliable in WebKit — prefer the native Rust command.
- The existing `clipboardRef` path can stay as a fast same-window in-app path,
  but the system-clipboard write is what enables cross-deck / cross-app paste.
