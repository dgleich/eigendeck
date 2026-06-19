# Notebook overlay — edge-case findings & E2E (overnight 2026-06-03→04)

Goal (David): land B2, build a notebook E2E suite, hunt edge cases — same
notebook on multiple slides, overlay save/restore, file-watching,
watching-vs-editing-off.

## TL;DR

- **B2 done as SHARE** (per David: synced = same thing = same overlay).
  Overlay keyed by `syncId ?? id`; duplicate sets `syncId = original.id`.
  In-session correct + E2E-verified (Duplicate → copy shows the SHARED
  overlay). v1 (independent clone) was wrong and was reverted.
- **E2E rig works headlessly** (tauri-driver + WebKitWebDriver + xvfb).
  Scenarios pass: load, overlay-load, overlay-heal, B2-duplicate.
- **BUG-0 (FIXED, commit 8b76f5f):** the in-place save path
  (flushToSqlite) wrote a duplicated synced element as a SEPARATE elements
  row instead of a junction to the shared row, so synced elements (text AND
  notebooks) detached on reload. (NOTE: my first writeup blamed "syncId not
  persisted" — wrong mechanism. Storage uses a shared element_id + multiple
  slide_elements junctions; db_import_json dedups correctly, flushToSqlite
  didn't.) Fix: flushToSqlite now emits a junction (db_add_element_to_slide)
  for synced added elements, mirroring db_import_json. Verified: dup +
  in-place save → 1 shared row + N junctions + 1 shared overlay, for text
  and notebooks; survives reload.
- Plus 3 more edge cases (BUG-2/3 + a minor behavior change).
- **Test-harness gotcha (FIXED):** WebKitGTK caches the JS bundle across
  runs → stale frontend silently served. e2e/run.sh now uses a throwaway
  XDG_CACHE_HOME per run. (This masked the fix during debugging.)

## E2E rig

Linux-only (tauri-driver has no macOS support). Needs `xvfb`,
`webkit2gtk-driver` (WebKitWebDriver), `tauri-driver` (cargo install).
Debug build loads `devUrl`, so the runner serves `dist/` on :1420; a CI
job should use a release build (self-contained) instead. Files in `e2e/`.

Scenarios passing:
- **load** — app launched with a `.eigendeck` arg opens it (file-assoc seam).
- **overlay-load** — overlay loads + merges; edited cell shows, raw hidden.
- **overlay-heal** — deck with TWO overlays for one element (empty+real,
  the test-1 corruption) → content-bearing one wins.
- **B2-duplicate** — open → click Duplicate → copy shows the cloned overlay.

## Answers to the questions

### Same notebook on multiple slides — does it work?
In-session YES (B2 share); across reload NO, blocked by BUG-0.

- Duplicate/Build make the elements **synced** (shared `syncId`). Per
  David's rule (synced = same thing = same overlay), the overlay is keyed by
  `syncId ?? id`, so all instances of a synced notebook resolve to ONE
  overlay. Duplicate sets `syncId = original.id` so that key is stable.
  E2E-verified in-session: open ov-single → click Duplicate → the copy
  shows the SHARED overlay (edited cell, not raw).

- **BUG-0 — `syncId` not persisted (the blocker):** the `elements` table
  has no `sync_id` column, and `flushToSqlite` strips `syncId` from the data
  blob. `db_export_json` only re-derives `syncId` when ONE element row is
  referenced by multiple `slide_elements` — a shape the incremental writer
  never creates (it writes a separate row per duplicated element). So after
  an in-place Save + reload, the synced elements have NO `syncId` and become
  INDEPENDENT. Verified: after duplicate+Cmd+S the saved deck had two
  notebook rows BOTH with `syncId = none`, and one overlay owned by the
  original's id → on reload the copy keys by its own id → shows empty.
  - This affects **content-sync generally**, not just notebooks: edit-one-
    update-all stops working after an in-place save+reload. (Animation
    `link_id` is fine — it IS a column.)
  - Ironic note: the reverted v1 (independent clone, per-id ownership)
    actually SURVIVED reload (each element kept its own overlay by id) —
    because it didn't depend on syncId. But it was the wrong semantics.
  - **Fix options (David to pick):**
    1. **Persist syncId properly** (add `sync_id` column, or make
       flushToSqlite create one shared row + multiple junctions for synced
       elements, and have db_export_json honor it). Correct + fixes the
       whole sync feature. Bigger, touches the core writer.
    2. **Key notebook overlays by `assetId`** (the .ipynb asset id, which IS
       persisted). Synced notebooks always share the asset, so sharing would
       survive reload. Downside: two INDEPENDENT notebooks of the same
       .ipynb would also share an overlay (rare; arguably acceptable).
       Notebook-only, small.
  - I lean (1) since it fixes sync everywhere; (2) is a fast notebook-only
    stopgap.

### Do overlays save/restore correctly?
Yes for the normal path (verified E2E load + heal + the #65 fix). Caveats:
- The Save-As collapse above.
- Overlay flush is debounced (800ms) + autosave; a duplicate/quit within
  that window before a flush could miss the freshest state on the DB side.
  B2's clone reads the in-session CACHE first, so it captures unflushed
  edits for the duplicate; but a raw quit-before-flush is a general
  overlay-durability edge (debounce window). Low risk.

### Does file watching work? Does it interface with editing off?
Coupling EXISTS but is **incomplete** (`PropertiesPanel.setEditable`,
~line 730): toggling editable ON sets the .ipynb asset `auto_reload='off'`;
OFF → `null` (follow default). Bugs:

- **BUG-2 (global-default editable doesn't disable watching):** editability
  also comes from the global pref `defaultNotebookEditable`. When a notebook
  is editable *via the default* (element.editable undefined), nothing sets
  the asset's `auto_reload='off'`. So a watched `.ipynb` changing on disk
  reloads → my content-based overlay reset fires → the user's overlay edits
  are dropped while they were editing. The coupling needs to also apply
  when effective-editable is true via the default, not just the toggle.

- **BUG-3 (per-asset setting vs per-element editable, shared .ipynb):**
  `auto_reload` is per-ASSET. If two notebook elements share one `.ipynb`
  (e.g. synced, or two notebooks of the same file), toggling editable on one
  flips watching for BOTH; toggling editable OFF on one re-enables watching
  even if the other is still editable. The asset-level flag can't represent
  per-element editability.

### Watching reset behavior (minor change, not a bug)
My earlier fix made overlay-reset content-based (overlaySourceChanged), so a
manual "Reload from disk" of an UNCHANGED file no longer drops the overlay
(nothing changed). The docs/comment say manual reload drops the overlay; now
it only drops it when the source actually differs. Arguably more correct;
flag in case the always-drop semantics were intended.

## Other observations
- Default kernel kind is `external`, so a bare notebook element uses
  `ExternalKernelBody` (the overlay path) — good for tests.
- Cells render offline (no kernel needed for display) — enabled E2E without
  a Jupyter server.
- Overlay duplicate-asset bug (this session) is structurally prevented now
  (deterministic id + content-preferring lookup) and the heal recovers old
  corrupted decks (E2E overlay-heal confirms).

## Suggested next steps (ranked)
1. **BUG-0: persist syncId** (or key notebook overlays by assetId) so the
   synced-overlay sharing — and content-sync in general — survives an
   in-place save+reload. Highest impact; pick fix option 1 or 2 above.
2. **BUG-2/BUG-3 (file-watching vs editable):** drive watching off whenever
   *effective* editable is true (not just the per-element toggle), and
   reconcile the per-asset `auto_reload` flag with per-element editability
   (e.g. watch only if NO bound element is editable).
3. Promote `e2e/` into CI (release build → drop the :1420 server hack).
4. Add E2E: multi-slide navigation; edit→save→reopen persistence;
   save→reload of a synced notebook (locks in the BUG-0 fix).
