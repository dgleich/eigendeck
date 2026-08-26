# Persistence bug-finding tests — 2026-08-26

Started the broader correctness campaign with the persistence/save-reopen slice from
`.claude/notes/parallel-bughunt-plan.md`. The aim was to replace spot checks with one
high-signal matrix covering every current presentation element type, its optional
properties, slide overrides, and deck configuration.

The inventory immediately found a real Save As/import defect. `_syncId` and `_linkId`
are persisted UI state: freeing or unlinking an element remembers its former group so
the user can later Re-sync or Re-link it. `db_import_json`, which is part of the Save As
path, removed both remembered IDs as though they were promoted live columns. Unlike
`syncId`/`linkId`, however, they had no column or export reconstruction path, so Save As
silently removed the remembered relationship and its UI action.

The fix preserves `_syncId`/`_linkId` in the element JSON while continuing to promote
the live `syncId`/`linkId` fields. The old Rust test that required the data loss was
corrected, and a new exact import/export persistence matrix now exercises all nine
element types, base remembered IDs, every current optional element property, slide
metadata/overrides, and presentation configuration. The matrix is intended to be
updated alongside `src/types/presentation.ts` as a compact storage checklist.

Verification: `npm run build` passed. Full Vitest initially had one environmental
failure because `better-sqlite3` in `node_modules` targeted an older Node ABI; rebuilding
that dependency (no tracked files or lockfile changes) made the shipped-deck
transparency test pass. The full rerun passed: 1559 tests, 1 skipped. After installing
the container's missing Rust/native build prerequisites and using an executable target
directory, `cargo check` and `cargo clippy -- -D warnings` passed. The serial library
suite passed with 88 tests and 1 ignored, including the new persistence matrix. The
repository-wide `cargo fmt --check` gate remains red because the installed stable
rustfmt proposes thousands of pre-existing changes across the Rust tree; those unrelated
files were not bulk-formatted as part of this work.

Next valuable slices are long state-machine edit/undo/save sequences and cross-render
mode property parity. Keep confirmed bug fixes small and independently green rather
than combining those campaigns with this storage correction.

## Generated editing state machine

The second slice added a deterministic store state machine: six fixed seeds, 160 edit
operations per seed, with the seed and complete operation trace printed on failure. It
mixes the operations actually reachable from the UI: slide creation, duplication,
deletion, sidebar drag/reordering, build creation, selection, element add/delete/update,
z-order changes, and movement. After every operation it checks that a deck still has a
valid current slide, slide and per-slide element ids remain unique, and geometry remains
finite.

The initial broad invariant (“one group id must always be contiguous”) was too strong:
`groupSlides`/`ungroupSlide` exist in the store but have no UI caller, and a useful UI
behavior is intentionally able to split and later rejoin a build. The concrete reachable
bug is narrower: start with a four-slide build, drag a standalone slide into its middle,
then drag a slide from one half elsewhere. `moveSlide` collected every slide globally
with the same `groupId`, pulling both separated halves back together.

The fix preserves the shared group identity and changes operations to act on the
**contiguous same-id run around the dragged slide**. The two halves therefore move
independently while divided. Moving the standalone divider elsewhere makes the halves
adjacent again, so they naturally rejoin without a new command or asymmetric UX. Two
focused regressions cover independent-half movement and divider-removal rejoining.

Verification after the narrowed slice: the focused state-machine + existing store suite
passed (74 tests), `npm run build` passed, and the full Vitest run passed with 1567 tests
and 1 skipped. The generated portion exercised 960 state transitions in that run.

## Real-user presentation build

Provisioned the Linux Tauri e2e rig and added `user-build-hunt-probe.mjs`, a broad
exploratory workflow that authors a four-slide talk through the real editor controls:
toolbar insertion, native WebDriver double-click into contentEditable, speaker notes,
element dragging, sidebar duplication, Add Build Slide through the context menu, Add
Slide, the video URL modal, and keyboard undo/redo. The automation seam is used only
to observe state and save in place, standing in for the native dialog WebDriver cannot
drive.

The probe saves and reopens the real SQLite deck, checks the authored text, notes,
video, slide structure, and then edits a synced duplicate after reload. This last step
also confirmed that the live distinct element IDs becoming one canonical persisted ID
is intentional sync normalization: the post-reopen UI edit correctly propagated to all
three synced instances. The first attempt's synthetic double-click failures were a
harness artifact; switching to native WebDriver pointer actions made the user gesture
faithful. The final run passed without uncaught JavaScript errors or reproducible
product defects.

## Asset-heavy presentation build

Extended the user workflow with `user-asset-build-hunt-probe.mjs`: a raster PNG,
an authored SVG diagram, and a 3.6 MB PDF are placed through the real canvas file-
paste handler, moved across three slides, and the raster is resized through its real
handle. The probe waits for the PDF to rasterize through Pdfium, saves/reopens the
SQLite deck, and checks element kind, asset identity, exact geometry, and embedded
byte availability. `run-probe.sh` now passes an optional `E2E_PDF`, and the shared
drag helper now follows the current slide instead of being hard-coded to slide zero.

An accelerated first draft moved the PDF while an autosave flush was in flight and
observed its position revert on reopen. A focused follow-up confirmed the underlying
race (#186): `flushToSqlite` iterated global dirty queues across awaited database calls,
then cleared them wholesale, so a same-ID edit added during the await was erased.

The fix serializes flushes and detaches each pending queue into a private batch before
the first database write. Concurrent edits accumulate in fresh queues, and the flush
drains those follow-up batches before resolving. Failed batches are merged back for a
later retry without overwriting newer same-key work. A deterministic Vitest regression
holds the first element write in flight, changes and re-queues that element, then checks
that both the original and newer geometry are written in order.

The asset probe retains its 1.4-second human cadence by default and accepts
`E2E_ASSET_SETTLE_MS` for explicit stress runs. At 50 ms, the real Tauri/WebKitGTK app
preserved exact raster/SVG/PDF geometry and bytes after save/reopen; the PDF remained at
`x=482` instead of reverting to its default `x=360`. The earlier text/build/video
workflow also passes.

Final verification for the flush fix: the focused store file passed 67 tests,
`npx tsc --noEmit` passed, the full Vitest suite passed with 1568 tests and 1 skipped,
and the accelerated real-app asset round trip passed at a 50 ms settle interval.
