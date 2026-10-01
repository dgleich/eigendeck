# Sync persistence: one id per element, SQLite as the source of truth

Status: draft for David's review, 2026-10-01. Fixes #194 to #201. Acceptance tests are on branch
`test/sync-link-hunt` (a8efd58); see "Testing" below.

## Why the bugs happen

SQLite already has the right model, and `docs/sync-and-link.md` describes it: an element is one
`elements` row, `slide_elements` junctions say which slides show it, and an element is synced when
it is referenced by more than one slide. The loader derives that correctly.

The JS store uses a different model. When a slide is duplicated, each copied element gets a brand
new id (`crypto.randomUUID()`) plus a `syncId` pointing at the original's id. So one synced element
on three slides is three JS objects with three ids, tied together by `syncId`. After a reopen the
same element has the row id on every slide, so the store holds two different representations
depending on whether the deck was reloaded since the duplicate.

The save compares the previous JS snapshot with the new one and replays the difference. Its ids are
instance ids, not row ids, so every write translates them with a guess, `syncId ?? id`. Once the
original element is deleted, freed or resynced, the guess names a row nobody owns and later edits
are dropped (#194). Because it compares two JS snapshots, it also has no idea what is already in the
database: an undo that brings back a saved element looks like a brand new add and is inserted
twice (#195). Most of #196 is JS-only state (`syncId`, per-instance link ids, a paste's stale clip
data) drifting away from what one row per element can hold.

## Rules

1. **One id per element, and it is the row id.** An element that appears on several slides has the
   same id on each of them, in the store and in SQLite. This is exactly the shape the store already
   has after a reopen, so the rest of the app already handles it.
2. **No JS-only state.** Every field the store holds for an element round-trips through its row:
   the data, `link_id`, and the remembered `_syncId` and `_linkId`. The one exception is `syncId`,
   which is derived, not stored (rule 3).
3. **Synced is derived.** An element is synced exactly when its id appears on more than one live
   slide. The store computes `syncId` with the same rule the loader uses, in one function, after
   every state change. No action sets it by hand.
4. **The save writes each changed slide whole.** For a slide that changed, one Rust call upserts the
   rows of its elements and sets its junctions to exactly that list, in that order. Nothing is
   inferred from a diff of snapshots.

## Identity in each operation

- **Duplicate slide / build slide.** The copy's elements keep their ids. Writing the new slide adds
  junctions to the existing rows, which makes them synced. The copies still get a shared `linkId`
  as today, so they stay animation-capable after a free.
- **Free.** The instance gets a new id (a new row with a copy of the data). `_syncId` is set to the
  row it left, and the copy stays linked to that row through `linkId`, as today.
- **Resync.** The instance takes the id in `_syncId` again, so the slide references that row, and it
  shows that row's current data (David's 2026-06 decision: resync means "the same element again";
  changes made while freed are discarded). It is only offered when that row is currently on another
  live slide, so it is hidden when every other copy has been deleted, and returns if that deletion
  is undone. `_syncId` is never rewritten by deletes, so `pruneOrphanedGroups` goes away.
- **Unlink / relink.** `linkId` moves to `_linkId` and back, on the element (its row).
- **Edits and moves.** `updateElement` and `moveElementsBy` apply the change to every instance with
  that id, on every slide. That is the same propagation as today, keyed by id instead of `syncId`.
- **Delete element / delete slide.** The slide stops referencing the row. The row is left alone, as
  any unreferenced row is today, and `compact` reclaims it later.
- **Undo / redo.** Unchanged (zundo with its debounce). An undo restores a snapshot, and the save
  writes the slides that changed. Because the write upserts rows and sets junctions, restoring an
  element that is already saved is an update, not a second insert.
- **Same-slide paste and Cmd+D.** A new row, as today.

## The save

The store subscriber stops diffing elements. It only finds which slides changed (the store updates
immutably, so a changed slide is a different object) and whether the slide list changed. Then:

- `db_write_slide(slide, elements)`: one transaction that upserts each element's row by id (writing
  a new version only when the data differs, so history does not fill with no-op versions), then makes
  the slide's live junctions exactly the given ids in the given order.
- `db_set_slides(ids)`: one transaction that sets slide order and closes slides that are gone (with
  their junctions, which `db_delete_slide` already does).

These replace the added/deleted/dirty/z-order queues, the add/delete cancellation block, the
two-pass row-versus-junction logic and every `syncId ?? id` lookup in the save. Both commands are
idempotent, so writing the same state twice is harmless. The 1s debounce stays. Sync/link actions
keep flushing immediately (006d924), and that flush now also checkpoints, so the main `.eigendeck`
file is current (#200).

The loader stays as it is, with one fix: a junction on a deleted slide must not count toward synced
(#199).

## Decisions for David

Each of these is a state the old code allowed but one row per element cannot hold.

1. **Paste onto a slide that already shows that element (B1).** Recommended: paste an independent
   copy (a new row, offset), as a same-slide paste does. The alternative is to refuse the paste.
2. **Unlink on a synced element (A1, A2).** The element is one row with one `link_id`, so unlinking
   any instance unlinks the element everywhere it appears. Recommended: allow it, and say so in the
   UI. The alternative is to disable Unlink on synced elements until one is freed.
3. **Linking into a link group that already has a member on the source slide (R1's precondition).**
   Recommended: refuse the link, so a link group has at most one element per slide and promote can
   never put two copies of one row on one slide.
4. **When a cross-slide paste joins (P1, U1, U3).** Recommended: it joins (reuses the row) when the
   source was synced when copied and its row is still on some live slide when pasted; otherwise it
   follows the unsynced-source rule (a new row, linked to the source if the source is still there).
   A joined paste shows the row's current data, not the clip's copy-time data.
5. **The grey A (relink) badge.** Recommended: the same rule as the S badge, shown only when some
   element on another live slide still carries that link id.

## Testing

The acceptance gate is already written and currently fails:

- `src/store/syncHunt.test.ts`: 36 failing unit tests, each named with its issue, must pass, and the 8
  guard tests must stay green.
- `e2e/run-all.sh`: the 23 sync entries (22 hunt scenarios with `E2E_EXPECT=clean`, plus
  `sync-durability-probe` `mainfile` for #200) must pass on every attempt.
- The full vitest suite, the full e2e suite, and the Rust tests stay green.
- New Rust tests for `db_write_slide` and `db_set_slides`: idempotence, junctions set exactly, no new
  row version when the data is unchanged, and no duplicate current rows.

Some existing unit tests assert today's id shapes (for example that a duplicate gets a fresh id).
Those change with rule 1, and each such change must be called out in the plan rather than silently
edited.

## What stays the same

The store actions and their UI, zundo undo and its debounce, the loader, `docs/sync-and-link.md`'s
user-facing semantics, assets, notebooks and the watcher. Previews and notebook overlays are keyed
by `syncId ?? id`, which under rule 3 is simply the element's id, so they keep working.

## Docs

`docs/sync-and-link.md` keeps its user-facing semantics and storage model. Two parts change: the
"Canonical id and in-session instances" section (the alias ids and no-op writes it describes go away;
in-session ids are row ids) and the store API notes (free, resync and the remembered ids as above,
plus the decisions once made). `docs/SQLITE_STORAGE.md` gets the two new commands.

## Out of scope

Making SQLite own every edit through Rust transactions, an undo redesign, and the macOS clipboard
(#188, #193).
