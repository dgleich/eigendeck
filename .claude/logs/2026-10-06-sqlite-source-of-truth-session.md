# SQLite is the source of truth: sync and link rebuilt on one id per element — 2026-09-24 → 10-06

This arc follows the 2026-09-24 resync log. It covers a hunt for sync and link
bugs, the design that came out of it, and its implementation on the branch
`test/sync-link-hunt`.

## The hunt

David asked for an agent to hunt edge cases in the sync and relink code, because
small fixes kept uncovering more. The hunt turned up issues #194 through #201 and
left two kinds of failing tests behind: 36 unit scenarios in
`src/store/syncHunt.test.ts`, which run a sequence of store actions, save through a
fake backend that mirrors the Rust SQL, reopen, and compare, and 23 sync entries in
`e2e/run-all.sh`, which do the same in the real app. Before any fix the probes
themselves were tightened so they could fail: the retry loop now restores a
pristine deck before each attempt, and checks that had been classed as
information or clamped (the slide index, database invariants, the WAL exit code)
now fail.

## Why there were so many bugs

The documents already said what sync is: one element row referenced by several
slides. The in-memory store did not hold that shape. A duplicate gave each copy a
fresh id with a `syncId` pointing back, while a reopened deck had the row id on
every slide, so the store held two shapes depending on whether the deck had been
reloaded. The save diffed snapshots and guessed the row with `syncId ?? id`, and
every bug class was that guess going wrong or JS state the row could not hold.
David's point was that synced should simply mean "this id is on more than one
slide," and that saving should write elements whole. The design kept the April
2026 decision that a link lives on the element row, so there is no schema
migration. It is recorded as the addendum "SQLite is the source of truth" in
`docs/sync-and-link.md`, with the plan in
`docs/superpowers/plans/2026-10-06-sqlite-source-of-truth.md`.

## What changed

Rust gained two idempotent whole-slide commands, `db_write_slide` and
`db_set_slides`, and the loader now counts only junctions on live slides (#199,
ca81d29). The store keeps element ids through duplicate and build, derives
`syncId` in one place after every change, and saves by writing each dirty slide
whole, with the remembered `_syncId`/`_linkId` kept in the row data (#194, #195,
#198). The immediate sync and link flush now also checkpoints (#200). Those are in
b26a994. Paste decides join, link or independent at paste time from the deck as it
is then, carries the copying deck's token so another deck never joins by a
coincidental id, and a link that would put two members of one group on a slide is
refused (6122ec7). The S and A badges are computed from the slides, so deletes no
longer prune ids and an undone delete brings its badge back; a synced element has
no Unlink, since it links only to its own copies (cb1c7bc). Undo now keeps the
slide index in range after undoing a duplicate of the last slide (#201, da5a272).

Several existing tests asserted the old id shapes, for example that a duplicate
gets a fresh id. Each change is named in its commit body.

## Results

The 36 hunt scenarios pass, and the full vitest suite is green (1956 tests). The
Rust storage tests pass serially. The end-to-end run is recorded below once it has
been made against a fresh build.
