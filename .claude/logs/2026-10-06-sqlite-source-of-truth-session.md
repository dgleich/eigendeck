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
is then, and a link that would put two members of one group on a slide is
refused (6122ec7). The S and A badges are computed from the slides, so deletes no
longer prune ids and an undone delete brings its badge back; a synced element has
no Unlink, since it links only to its own copies (cb1c7bc). Undo now keeps the
slide index in range after undoing a duplicate of the last slide (#201, da5a272).

Several existing tests asserted the old id shapes, for example that a duplicate
gets a fresh id. Each change is named in its commit body.

## What the final review found

A fresh reviewer read the whole branch and found two problems the plan's tests
missed. A deck damaged by #195 can hold two junctions for one element on one
slide. The loader listed that element twice, the slide's whole write was then
rejected, and because the save wrote all slides in one try, every later edit in
the session quietly failed to save. Both loaders now list an element once per
slide, and the save writes each slide on its own (5e0b0ab). The same commit makes
the write compare data as JSON, since a reopened deck's keys come back in a
different order and the first write after every open was adding a new version of
every element. The second problem was paste: a Save-As copy shares the original's
ids and deckToken, so a header copied from last year's talk joined the sync group
in this year's copy. Clips now carry a per-session paste identity that is renewed
on open, close and Save As (7442285). The badge reopen probe asserted an A badge on
a synced element, which the new rule removes; it now asserts there is none.

## Results

The 36 hunt scenarios pass, and the full vitest suite is green (1960 tests). The
Rust storage tests pass serially (97), clippy is clean, and the rustfmt drift is
unchanged from before the branch. The full end-to-end run on the final build gave
153 of 154 probes passing, with every sync entry passing on its first attempt. The
one failure, a2-elprops, compared the saved element's JSON with key order
significant. Its fixture already held the values the probe sets, so the JSON
compare in db_write_slide correctly wrote no new version and the row kept the key
order it was stored with. The probe now compares values (it still fails on a
wrong value), and a second full run passed all 154 probes with no retries.

Still open: #190 (watched-asset durability, mitigated) and #191 (David's
free-reverts-on-reload report, never reproduced). Deferred from the review: the
image paste path links with no deck check, a failed save only logs to the console,
a refused link gives no feedback, and the badges re-render on every drag frame.
