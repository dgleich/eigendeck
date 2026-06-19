# Notebook cell views (subset display) — plan

From David: "show only an h1 block of the file (needs a button to run all
previous cells, in case it depends on them), or show only a single cell …
need some way to preview other cells."

## What exists
- `NotebookElement.visibleCells?: number[]` — a whitelist of .ipynb cell
  indices. The renderer filters to it (`filterCells`/`filterMerged` in
  NotebookContent). Empty/absent = show all.
- That's the only piece. There is **no inspector UI to set visibleCells**,
  no section concept, and no way to run the hidden cells a visible subset
  depends on.

## The four asks → design

1. **Preview other cells (authoring UI).** A cell picker in the notebook
   inspector (PropertiesPanel): list ALL merged cells (ipynb + overlay) as
   compact previews — markdown heading text, or the code's first non-blank
   line + a [n]-cell tag. Each row has a visibility checkbox; hidden rows
   dimmed. Visible set = `visibleCells` (all when empty). Bulk actions:
   All / None. This is the "preview other cells" surface and the place the
   other shortcuts live.

2. **Show only an h1 block.** Parse markdown cells for `#` (h1) headings →
   regions = [h1 cell .. just before next h1]. Picker offers "Show section
   ▸ <title>" per h1, setting `visibleCells` to that region's indices.
   (Start with h1; h2/h3 optional later.)

3. **Show only a single cell.** Per-cell action ("Only this cell") →
   `visibleCells = [i]`. Available in the picker and/or on the rendered
   cell's toolbar.

4. **Run all previous cells (runtime).** When `visibleCells` is a subset
   whose first visible index > 0, the rendered notebook shows a "Run
   previous cells" button that executes the HIDDEN prefix (indices
   0..firstVisible-1, in order) so the visible region's code has its
   imports/vars in the kernel. Records to the overlay like a normal run.
   Only meaningful with a live external kernel; hide it for lite/no-kernel.
   - Edge: hidden cells AFTER the first visible one (gaps) — v1 runs only
     the prefix before the first visible cell (the common dependency case).
   - Show kernel-not-ready / running state on the button.

## Build order (suggested)
- A. Inspector cell picker with checkboxes + All/None + "Only this cell".
     (Delivers #1 and #3; smallest, unblocks authoring of visibleCells.)
- B. h1-section parsing + "Show section" entries in the picker (#2).
- C. Runtime "Run previous cells" button (#4) — needs the kernel/execute
     path already used by CodeCell run.

## Open questions
- h1 only, or h2/h3 sections too?
- "Run previous": prefix-before-first-visible only (v1), or all hidden
  cells including gaps?
- Picker lives in the inspector (authoring) — agreed? Or also a quick
  affordance on the slide in interactive mode?
- Does hiding a cell also hide its recorded OUTPUT, or just the source?
  (Today filter is all-or-nothing per cell.)

## Files
- `src/types/presentation.ts` — NotebookElement.visibleCells (exists).
- `src/components/notebook/NotebookContent.tsx` — filterCells/filterMerged
  (render filter), where a "Run previous" button would mount.
- `src/components/PropertiesPanel.tsx` — notebook inspector (add picker).
- `src/lib/notebookOverlay.ts` mergeNotebook / notebookFormat — cell list +
  markdown heading parse for sections.
