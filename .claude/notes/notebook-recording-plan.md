# Notebook recording-as-asset — plan

Branch: `feat/notebook-recording` (off `feat/notebook-spike`).
Big structural change; revertable as a unit.

## Core model

eigendeck is **not a notebook editor** (never mutates the user's
`.ipynb`) but **is a recorder** (it remembers the live session).

Each notebook element binds TWO assets:
- `assetId` → the pristine `.ipynb` (source; may be linked/watched;
  never mutated by eigendeck).
- `recordingAssetId` → an eigendeck-owned asset, mime
  `application/x-eigendeck-nb-recording+json`, holding the recording
  JSON. No external_path, no watching. Versioned via the existing
  temporal asset history (free Restore UI).

Recording JSON:
```
{
  version: 1,
  cellEdits:   { [ipynbIndex: number]: string },        // source overrides
  cellOutputs: { [ipynbIndex: number]: CellOutput[] },   // recorded outputs
  appendedCells: [ { id: string, afterIndex: number|null, source: string,
                     outputs?: CellOutput[] } ],          // live-authored cells
}
```

## Behavior

- **Outputs record passively** on every run (regardless of `editable`).
  → eigendeck the recorder.
- **Source edits** record only when `editable` is on. Existing-cell
  edits → `cellEdits[index]`; brand-new cells → `appendedCells`.
- **Display = merge**: parse `.ipynb` → apply `cellEdits` (source) +
  `cellOutputs` (output precedence: recorded → baked-in → none) →
  splice in `appendedCells` at their positions.
- **Recording lives in memory during a session; flushed to a new
  recording-asset version on deck save** (versions = save points).
- **Reload-from-disk** on the `.ipynb` clears the recording (re-sync
  to pristine).
- `.ipynb` asset NEVER written by recording. (Rare explicit "bake to
  .ipynb" could be a later escape hatch — not in v1.)

## Visual distinction (user ask)

Cells/parts from the recording must look distinct from pristine
`.ipynb` cells:
- **edited source** (cellEdits) → amber left-accent + tiny "edited" tag.
- **appended cell** → blue/teal left-accent + "added" tag.
- **recorded output** → subtle marker (small dot) vs baked-in.
- pristine cell → no accent.

## Per-user fit

| user | .ipynb | recording holds |
|---|---|---|
| canned demo | full | outputs (baked once at build) |
| teacher | full | outputs (+ ephemeral edits) |
| real-time presenter | seed | edits + outputs |
| live coder | ~empty | appendedCells + outputs |

## Phases (commit boundaries)

1. Data model: `recordingAssetId` on NotebookElement; recording JSON
   types + lib (parse/serialize/merge). Migration: fold existing
   `cellEdits` overlay → recording on load.
2. Display merge + visual distinction (read-only from recording).
3. Passive output recording → in-memory → flush to recording asset
   on save. Reload-clears.
4. Source edits → recording (replace the old direct cellEdits write).
5. appendedCells + add/delete/reorder-cell UI (live-coding).
6. Versioning granularity polish + docs (DESIGN_DECISIONS, manual,
   LLM-EDITING).

## Open / deferred
- "Bake recording into .ipynb" explicit action — later.
- Static notebook rendering in HTML/PDF export (needed for "capture
  outputs → shareable HTML") — separate feature, not this branch.
- source-hash per recorded output for stale-output cue — optional.
