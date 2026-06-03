# Notebook recording — integration test plan (P2–P5 + storage)

Companion to the lib-level suites:
- `src/lib/notebookRecording.test.ts` — original happy-path (10 tests).
- `src/lib/notebookRecording.merge.test.ts` — adversarial lib coverage
  (71 passing + 1 `it.skip` for the orphan-anchor gap).

This doc lists the INTEGRATION tests for the phases that don't exist in
the lib yet (display merge, recording/flush behavior, migration,
appended-cell UI, and the storage hardening). Implement test-by-test as
each phase lands. Each entry is `name → assertion` so it's ready to
write.

---

## Findings from the lib-level pass (read before P2–P5)

These are CURRENT behaviors the merge suite pins. Some are sharp edges
worth fixing during integration; none are "the test is wrong."

1. **Orphan appended cells vanish.** `mergeNotebook` only emits an
   appended cell if its `afterIndex` is `null` or matches an existing
   `cell.index`. If the `.ipynb` shrinks below the anchor (or the anchor
   was always bogus), the live-authored cell is silently dropped — data
   loss from the user's POV. Tracked by the `it.skip` "DESIRED: orphaned
   appended cells are emitted at the tail as detached". **P5 must
   address index-drift; see P5 below.** (Not a crash; a design gap.)

2. **`parseRecording` does not validate output shapes.** `cellOutputs`
   values only need to be arrays; their elements are cast to
   `CellOutput[]` unchecked. Appended-cell `outputs`/`executionCount`
   are not validated by `isAppended` at all (e.g. `outputs:"not-an-array"`
   survives parse). A corrupted recording asset can therefore carry
   malformed outputs into the renderer. **Renderer must tolerate
   malformed outputs**, OR parseRecording should deep-validate. Decide in
   P2; add a renderer-robustness test there.

3. **Numeric-key coercion quirks** (`Number()` semantics): `""` and
   `" "` → index 0; `"1e3"` → 1000; negative and huge indices are
   retained. None match real cells except the empty/whitespace→0 case,
   which could let a corrupt key collide with cell 0. Low severity;
   documented, not blocking.

4. **A recorded empty output array (`cellOutputs[i] = []`) is
   meaningful** — it means "ran, produced nothing" and both
   `isRecordingEmpty` returns false and merge suppresses the baked-in
   output. P3 flush logic must preserve this distinction (don't treat
   `[]` as "no recording").

5. **`cellCounts` is in the `Recording` type but NOT in the plan's JSON
   schema** (`.claude/notes/notebook-recording-plan.md` shows
   `appendedCells` with `outputs` but omits `cellCounts`). Reconcile the
   plan doc with the implemented type during P6 docs. Not a test, but
   note it so the schema doc and LLM-EDITING.md don't drift.

---

## P2 — Display merge + visual distinction

Component-level (render the merged list; assert markers/accents). Use
jsdom + the renderer component once it exists.

- `edited source cell gets the 'edited' marker` → render a notebook where
  `cellEdits[i] !== cell.source`; assert the cell's DOM has the edited
  accent/tag (amber left-accent + "edited" per plan).
- `edit equal to source shows NO marker` → `cellEdits[i] === cell.source`;
  assert no edited marker (mirrors `edited===false` from merge).
- `appended cell gets the 'added' marker` → assert blue/teal accent +
  "added" tag on `origin:'appended'` cells.
- `recorded output gets the 'recorded' marker` → `cellOutputs[i]` present;
  assert the subtle recorded-output dot is present and baked-in output
  cells have none.
- `pristine cell has no accent/marker` → empty recording; assert clean.
- `markers are theme-aware` → render under light and dark theme; assert
  accent colors resolve from CSS variables (not hardcoded), and contrast
  is non-zero in both.
- `appended code cell renders its recorded outputs` → appended with
  `outputs:[stream]`; assert the output is shown.
- `renderer tolerates malformed recorded outputs` (Finding #2) → feed
  `cellOutputs[i]=[{kind:'bogus'}]` / appended `outputs:"not-an-array"`;
  assert the cell still renders (no throw), unknown output kinds skipped.
- `merged order in DOM matches mergeNotebook order` → top-anchored +
  index-anchored + edits interleaved; assert DOM child order equals the
  `mergeNotebook` array order.

## P3 — Passive output recording + flush-on-save

Drive the store/recording controller (mock kernel run + save).

- `running a code cell records its output into the in-memory recording`
  → simulate a run producing stdout; assert `recording.cellOutputs[i]`
  and `cellCounts[i]` set.
- `running records regardless of editable=false` → editable off; run;
  assert output still recorded (eigendeck-the-recorder).
- `a run producing nothing records an empty outputs array, not absence`
  (Finding #4) → assert `cellOutputs[i] === []` and `isRecordingEmpty`
  is false.
- `save flushes the in-memory recording to a new recording-asset version`
  → mutate recording, save deck; assert a new asset version written with
  serialized recording bytes.
- `flush only happens when the recording changed (hash/dirty differs)`
  → save twice with no change between; assert only ONE new version (no
  duplicate version on the second save).
- `autosave does NOT spam flushes` → trigger N autosaves with no
  recording change; assert zero new recording-asset versions.
- `autosave WITH a recording change flushes exactly once` → change then
  autosave; assert one new version.
- `present-mode autoRun does NOT flush` → enter present mode, autoRun
  executes cells (mutating in-memory outputs); assert NO recording-asset
  version is written (present mode is ephemeral).
- `manual reload-from-disk clears the ENTIRE recording` → populate
  cellEdits + cellOutputs + appendedCells; manual reload; assert the
  recording is back to `emptyRecording()` (all three cleared) and the
  recording asset reflects empty (or is detached) per design.
- `watcher reload-from-disk clears the ENTIRE recording` → same as above
  but triggered by the file-watcher path; assert identical clearing.
- `reload clears appended cells too (not just edits/outputs)` → explicit:
  appendedCells non-empty before reload, empty after. (Guards a likely
  partial-clear bug.)

## P4 — Migration (legacy `cellEdits` overlay → recording)

Unit/integration on the migration function + load path.

- `cellEdits present, no recording → new recording with those edits` →
  assert `recording.cellEdits` equals the legacy map, version 1, other
  collections empty.
- `cellEdits present, recording ALSO present → legacy folded in without
  clobbering recorded outputs/appended` → assert outputs/appended
  preserved; decide+assert precedence on key collisions (recording wins
  vs legacy wins — pin the chosen rule).
- `empty cellEdits is a no-op` → no recording created/modified; element
  unchanged except field strip.
- `legacy cellEdits field is stripped after migration` → assert the
  NotebookElement no longer carries the old `cellEdits` field.
- `migration is idempotent` → run load twice; second load is a no-op
  (no field to migrate, recording unchanged).
- `migration creates a recordingAssetId if absent` → assert the element
  gains a `recordingAssetId` bound to the new asset.

## P5 — Appended cells (add / delete / reorder; anchor stability)

Store actions + merge interaction.

- `add appended cell after index i → appears after cell i in merge` →
  assert position and `origin:'appended'`.
- `add appended at top (afterIndex null) → renders before all ipynb` .
- `add multiple at same anchor preserves insertion order` (lib-covered;
  re-assert through the store action so UID generation is exercised).
- `delete appended cell by id removes it from recording + merge` .
- `reorder appended cells under the same anchor updates render order` →
  reorder the `appendedCells` array; assert merge order follows.
- `each appended cell gets a stable unique id` → add several; assert ids
  unique and survive serialize/parse.
- `anchor stability when .ipynb GROWS` → add cells above the anchor in
  the .ipynb (re-parse); since anchors are by ORIGINAL index, document &
  assert the resulting position (anchors do NOT auto-shift — pin this).
- `index-drift when .ipynb SHRINKS below an anchor` (Finding #1) →
  appended anchored to index 2; reload an .ipynb with only 1 cell;
  CURRENT: appended vanishes. Assert current behavior AND keep an
  `it.skip`/TODO for the DESIRED tail-emit-as-detached (mirrors the lib
  suite's skipped orphan test). This is the headline data-loss risk.
- `editing an existing-cell source while appended cells exist does not
  disturb appended ordering` (lib-covered; re-assert via store).

## Storage hardening — REGRESSION tests (add when hardening lands)

The 3 blockers from review. Each maps to a concrete assertion; add as
regression guards so the bug can't return.

- **GC reachability keeps `recordingAssetId`-referenced assets.**
  `compact does not delete a recording asset that is referenced by a
  notebook element` → create deck with a notebook element + recording
  asset; run Compact/GC; assert the recording asset still resolvable by
  id (and its temporal history intact). Regression for: GC treated
  recording assets as unreachable and deleted them.

- **Recording created with an explicit UUID survives hash-dedup.**
  `two empty recordings on two elements get DISTINCT asset_ids` → create
  two notebook elements, each with a fresh empty recording; assert
  `recordingAssetId_A !== recordingAssetId_B` (content-hash dedup must
  not collapse them, because empty recordings are byte-identical).
  Regression for: hash-dedup merged two independent recordings into one
  shared asset.

- **`duplicateSlide` clones the recording.**
  `duplicating a slide with a notebook element deep-clones its recording`
  → duplicate a slide; edit the copy's recording (e.g. add a cellEdit);
  assert the ORIGINAL slide's recording is unchanged (distinct
  asset_ids, no shared mutable reference). Regression for: duplicate
  shared the same recordingAssetId so edits leaked across copies.

---

## Suggested file layout for the integration tests

- `src/store/notebookRecordingFlush.test.ts` — P3 (run/flush/reload).
- `src/store/notebookRecordingMigrate.test.ts` — P4.
- `src/store/notebookAppended.test.ts` — P5 store actions.
- `src/components/NotebookRender.test.tsx` — P2 visual markers (jsdom).
- `src/store/notebookRecordingStorage.test.ts` — the 3 storage regressions.
