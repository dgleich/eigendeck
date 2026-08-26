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
