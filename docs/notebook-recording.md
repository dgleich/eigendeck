# Notebook recording — design

How Eigendeck layers in-deck edits, captured outputs, and new cells on top of a
read-only `.ipynb`, without ever modifying the source notebook. Sibling to
`ASSETS.md` and `docs/sync-and-link.md`; the user-facing version is
`docs/manual/notebooks.md`.

## The model in one paragraph

A notebook element renders the **pristine `.ipynb`** (an asset, watched like any
other file — see `ASSETS.md`) with a **recording** merged on top at display time.
The recording is a small JSON blob — cell edits, captured outputs, execution
counts, and appended cells — stored as its **own asset** that is *owned by the
element*. The `.ipynb` bytes are never written back; everything you do to the
notebook in the deck lives in the overlay, in the deck. Open the deck later with
no kernel and your edited code + captured outputs are right there.

## The overlay (recording)

```ts
interface NotebookOverlay {
  version: 1;
  cellEdits:   { [ipynbCellIndex: number]: string };   // replace a cell's source
  cellOutputs: { [ipynbCellIndex: number]: Output[] };  // captured run outputs
  cellCounts:  { [ipynbCellIndex: number]: number };    // execution_count
  appendedCells: AppendedCell[];                        // cells authored in-deck
}
```

- **Stored as an owned asset.** mime `application/x-eigendeck-overlay+json`,
  `auto_reload: 'off'` (it's deck state, never a watched file), and
  `assets.owner_element_id` set to the element it belongs to. See
  `lib/useOverlay.ts` (`writeOverlayFor` / `loadOverlayFor`).
- **Owner key = the element's sync identity = `syncId ?? id`** (same key the
  preview cache uses). Synced notebook instances are one element → they share one
  recording.
- **Merge happens in `NotebookContent`**, not in the data: `cellEdits[i]` replaces
  the i-th `.ipynb` cell's source for display + execution; `cellOutputs`/
  `cellCounts` override per cell; `appendedCells` render after the `.ipynb` cells.
  The `.ipynb` asset is untouched, so file-watch reload of the base just re-merges.

## Why an owned asset (not a field on the element)

The overlay can be large (captured outputs) and is binary-ish JSON; assets already
give us storage, history, GC, and Save-As forking for free. Tagging it with
`owner_element_id` lets the backend find/heal/close it by element without the store
knowing the byte format. Rust: `db_store_asset({ ownerElementId })`,
`db_get_owned_asset_id`, `db_close_owned_overlay`.

## Lifecycle: keeping owner = canonical id

The invariant: **an overlay must be owned by the element's canonical id**, or it's
unreachable (looked up by `syncId ?? id`) after a reload.

- **Import heal** (`db_import_json`, storage.rs): re-owns overlays from dead
  in-session instance ids or a bare `syncId` to the canonical element id, so a
  duplicated/synced notebook's recording survives a round-trip.
- **Per-type hooks** (`lib/elementLifecycle.ts`, registered in
  `components/notebook/notebookLifecycle.ts`) keep the store type-agnostic — it
  fires generic `run*Hook`s and the notebook type does the overlay work:
  - `onFree(el, newId)` → `cloneOverlay(syncId, newId)`: a freed instance gets its
    own copy of the group's recording (it's becoming its own row).
  - `onResync(el)` → `discardOverlay(el.id)`: rejoining the group drops the private
    fork so it doesn't shadow the group's.
  - `onMerge({source, target, keep})` → `applyLinkOverlay(...)`: promote/merge keeps
    one recording (explicit winner, else whichever has content) and
    `db_close_owned_overlay`s the loser.
  - `onCopy(source, copy)` → `cloneOverlay(source key, copy key)`: duplicate/paste
    carries the recording (no-op when the copy joins the same sync group → same key).

## Preview cache

A notebook renders offline, so a faithful PNG can always be captured. `capturePreview`
(`lib/previewCache.ts`) screenshots the rendered `.nb-frame` into `asset_cache`
(variant `preview`, keyed by `syncId ?? id`), debounced on overlay change. Reused
by the sidebar thumbnail and static export. A `source_hash` (cyrb53 of the node's
outerHTML + size) skips re-capture when nothing changed. `ElementPreviewImg` is the
read side; it re-reads on `onPreviewChange`. (Same machinery now serves demos and
videos.)

## Gotchas

- `cellEdits` are keyed by the `.ipynb` cell **index**, so editing requires
  watching to be off (editable ⇒ take control), or index drift could mis-apply an
  edit. See `docs/manual/assets.md`.
- An incidental `eigendeck:asset-changed` for the notebook's `.ipynb` must not wipe
  the overlay — `notebookOverlay` guards against that.
- The overlay is loaded by `syncId ?? id`; if that key is wrong after a structural
  edit (free/resync/merge/copy/duplicate), the recording looks lost. The lifecycle
  hooks + import heal exist precisely to keep that key correct.
