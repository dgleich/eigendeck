# Sync / link persistence hunt (2026-09-24)

Branch `fix/resync-persistence` at 5ceafbe. Nothing was fixed. The only tracked-file change
(the temporary pre-006d924 emulation in `flushSyncLinkNow`) was reverted, `git diff --quiet -- src/`
passes, and `dist/` was rebuilt with the seam from the restored source (verified: W1 reproduces
again, which it does not under the emulation).

## How this was tested

**Harness (fast tier).** `src/store/syncHunt.test.ts` drives the real store actions, the real
`pasteInternalClip`, real `undoWithNav`/`redoWithNav` and the real `flushToSqlite` against a fake
Tauri backend. The fake runs on real SQLite (`node:sqlite`) and uses the same SQL statements as
`storage.rs` for every command the save path calls, including its quirks: `db_add_element` always
INSERTs, `db_add_element_to_slide` skips an existing live junction, `db_update_element` is a no-op
without a row, `db_update_z_order` closes and then INSERTs even if no junction existed,
`db_add_slide` always INSERTs, and the loader counts every current junction when it derives
`syncId`. "Reopen" is `closeSqliteProject` + `openSqliteProject` through the same
`db_load_presentation` logic. After each flush the session is compared with what a reopen would
load, and the DB is checked for duplicate current rows, duplicate junctions, junctions to missing
rows or dead slides, and duplicate slides. Three save behaviours are modelled: `every` (flush after
every op), `syncnow` (current code: sync/link ops flush at once, everything else waits for the 1s
debounce) and `batched` (pre-006d924: one flush per explicit save). A shrinker reduces each failing
random sequence to a minimal one. Named scenarios run in the normal `vitest run` as real tests: any
finding fails the test, and each test name carries its issue (#194-#201). As originally written they
only reported, and `remembered:lost` and the out-of-range slide index were classed as info (the
harness even clamped the index after undo, hiding #201). That was changed on 2026-09-25, so those
bugs fail too. The fuzzer runs with `HUNT=1` (usage is in the file header).
About 15,000 random sequences of 14 to 30 ops were run (plus the shrinker's reruns) over 4
fixtures, 3 save modes, and with and without cross-session undo seeding.

**Real app (confirm tier).** `e2e/sync-hunt-probe.mjs` (one scenario per `E2E_MODE`) drives the
real store through the seam, real copy/paste `ClipboardEvent`s and real Cmd+Z / Cmd+Shift+Z
keydowns, saves, quits, reopens in a new session and compares. It then inspects the saved file with
read-only python sqlite3. Fixtures come from `node e2e/sync-hunt-fixtures.mjs <dir>` (CLI import).
To run one scenario:

```
node e2e/sync-hunt-fixtures.mjs $SP/fx          # once
D=$(mktemp -d $SP/e2e.XXXXXX); cp $SP/fx/solo.eigendeck $D/deck.eigendeck
E2E_APP=$HOME/el-target/debug/eigendeck E2E_DECK=$D/deck.eigendeck E2E_MODE=L1 \
  PROBE=/work/e2e/sync-hunt-probe.mjs bash e2e/run-probe.sh
```

The probe prints `SYNCHUNT <mode> REPRODUCED|CLEAN <details>`. Scenario ids below (L1, C2, …) are
the same in the harness and the probe. With `E2E_EXPECT=clean` it exits 1 when a finding
reproduces; every confirmed mode is in `e2e/run-all.sh` that way, plus
`sync-durability-probe.mjs` `E2E_MODE=mainfile` for #200. As originally written the probe printed
database violations (duplicate rows, dangling junctions, z ties) and the IDX slide index without
counting them, and its WAL flow always exited 0; since 2026-09-25 all of those count as failures.

## Summary

| # | Finding | Class | Status | Severity |
|---|---------|-------|--------|----------|
| L1 | Duplicate slide, delete the ORIGINAL slide, edit the copy: edit lost | 1 | CONFIRMED | data loss |
| L3 | Duplicate, delete the original element, move the copy: move lost | 1 | CONFIRMED | data loss |
| L4 | Duplicate, delete the original element, delete the copy: copy resurrects | 1 | CONFIRMED | data loss (resurrect) |
| L5 | Duplicate, delete the original element, reorder the copy: order lost, dangling junction | 1 | CONFIRMED | cosmetic + DB corruption |
| F2 | Duplicate, FREE the original, edit the copy: edit lost | 1 | CONFIRMED | data loss |
| F3 | Duplicate, free the original, resync it, edit: edit lost everywhere | 1 | CONFIRMED | data loss |
| D1 | Move (or edit) the original, then free it within 1s: other slides lose the move | 1 | CONFIRMED | data loss |
| C1 | Delete element + Cmd+Z within 1s: element appears twice on reopen, both "synced" | 2 | CONFIRMED | wrong sync state + duplicate |
| C2 | Delete slide + Cmd+Z within 1s: slide appears twice, every element doubled and "synced" | 2 | CONFIRMED | data corruption |
| C4/C5 | Delete (element or slide), Cmd+Z, Cmd+Shift+Z within 1s: deletion lost | 2 | CONFIRMED | data loss (resurrect) |
| C3 | Delete element, (autosave), Cmd+Z: duplicate current row in the DB | 2 | CONFIRMED (also in David's deck) | latent DB corruption |
| U2 | Duplicate, free the copy, Cmd+Z, Cmd+Z: the ORIGINAL comes back synced | 2+6 | CONFIRMED (current code only) | wrong sync state |
| FUR | Free, Cmd+Z, Cmd+Shift+Z within 1s: freed copy AND a synced copy on reopen | 2 | CONFIRMED under pre-006d924 behaviour | wrong sync state |
| A1 | Unlink one synced instance: link comes back (or the whole group unlinks) | 3 | CONFIRMED | wrong link state |
| B1 | Paste a synced clip onto a slide that already holds the group: extra copy dropped | 3 | CONFIRMED | data loss (small) |
| P1 | Copy synced, edit the group, paste: pasted member shows stale content until reopen | 3 | CONFIRMED | wrong display / silent change |
| R1 | Promote a link group with two members on one slide: duplicate ids on a slide | 3 | CONFIRMED | corrupt session state |
| U1/U3 | Paste a synced clip after its group dissolved: the original comes back synced | 3 | CONFIRMED | wrong sync state |
| Z2 | Delete an element then add one: stacking order flips on reopen | 4 | CONFIRMED | cosmetic |
| RM | `_syncId`/`_linkId` are not saved: after reopen a freed element cannot re-sync | 5 | CONFIRMED | wrong sync state |
| W1 | A free is left only in the WAL (no checkpoint) until some later edit, save or close | 7 | CONFIRMED (regression from 006d924) | wrong sync state on a copied/synced file |
| IDX | Undo of a slide duplicate leaves `currentSlideIndex` out of range | incidental | CONFIRMED | crash risk (not persistence) |

## Class 1: the save addresses rows by the session's instance id, and a transition can leave no instance whose id is the row

**The pattern.** A sync group is one `elements` row. In the session, only one instance (the
canonical one, whose `id` is the row id) maps to that row. Every other instance is an alias with a
fresh id: `duplicateSlide` and `addBuildSlide` mint them (`presentation.ts:316-320`, `469-473`),
and so does a paste that joins a group (`pasteClip.ts:70`). The flush writes element data by
instance id (`db_update_element({ id: elementId })`, `presentation.ts:1404-1421`). An alias write
is a deliberate no-op (`storage.rs:1205-1216`), which is safe only while the canonical instance is
in the session and gets the same change. Deletes use `syncId ?? id` as the junction id
(`presentation.ts:1869-1871`) and z-order uses `syncId ?? id` (`1452-1458`). Both assume that an
instance without `syncId` is its own row.

Four transitions break those assumptions. Deleting the canonical instance or its slide takes the
row's only owner away. `freeElement` renames the canonical instance to a fresh id
(`presentation.ts:602, 624`). `resyncElement` also mints a fresh id (`679, 686`), so a group whose
canonical was freed and re-synced has no owner at all. Finally, `pruneOrphanedGroups`
(`syncLink.ts:69-99`, called from `deleteSlide` at `presentation.ts:285` and `deleteElement` at
`814`) strips `syncId` from a surviving alias without changing its id, so the alias now looks
like its own row. After any of these, every later data write for the group goes to ids that have
no row, every delete closes a junction that does not exist, and every z-order write inserts a
junction for a row that does not exist (`storage.rs:1995-2016`). This is the same lesson as #192
turned around: #192 was a transition that moved an instance to another row without an id change;
here the transitions change or remove ids, but the save still addresses the row by an id that no
longer names it.

**L1. Duplicate slide, delete the original slide, edit the copy.** *CONFIRMED* (probe `L1`,
harness scenario `L1`, flush after every step). Expected: the copy keeps the edit after reopen.
Actual: in the session the copy says EDITED, after reopen it says A. Every later edit to that
slide's duplicated elements is lost for the rest of the session. The trigger is ordinary: duplicate
a slide, throw the old one away, keep working. Severity: data loss.

**L3 / L4 / L5. Duplicate, delete the original element, then move, delete or reorder the copy.**
*CONFIRMED* (probe `L3`, `L4`, `L5`). With two members, the delete prunes the alias's `syncId`.
Then the alias's move is written to a missing row (L3: x=400 in the session, 100 on reopen), its
delete closes a missing junction so it comes back on reopen (L4), and its "bring to front" writes a
dangling junction `(slide, aliasId)` while the real junction keeps its old z (L5: order flips and
the DB has a dangling junction plus a z tie). The link that prune removed also reappears on reopen.
Severity: data loss (L3, L4), cosmetic plus DB corruption (L5).

**F2. Duplicate, free the ORIGINAL, edit the copy.** *CONFIRMED* (probe `F2`, both save
behaviours). This is the documented duplicate → free → move → animate flow, freeing the first
frame instead of the second. The free renames the row owner, so the copy's edit (EDITED in the
session) is back to A on reopen. Severity: data loss.

**F3. Duplicate, free the original, resync it, edit.** *CONFIRMED* (probe `F3`). After #192 the
resynced instance is also an alias, so no instance owns row A. The edit shows on both slides in
the session and is gone from both after reopen. The #192 fix is itself one of this class's
triggers. Severity: data loss.

**D1. Move or edit the original, then free it within 1s.** *CONFIRMED* (probe `D1`, current
code). The move marks id `A` dirty. The free renames `A` and flushes at once. The dirty loop looks
up `A` in the new state (`presentation.ts:1404-1407`), finds nothing, and drops the write. The
copy on the other slide is at x=300 in the session and at x=100 on reopen. The link id set on `A`
by the duplicate is lost the same way. Under the old batched save, any group edit made in the
same debounce window as a free of the canonical instance is lost. Severity: data loss.

**Also in this class (HARNESS-ONLY).** M1: pasting a synced clip into a group whose other members
were pruned creates a lone `syncId` instance whose later moves are written to nothing. L6:
when a group's canonical instance is deleted before it was ever saved (add an element, duplicate
the slide twice, delete the original, all inside one debounce), the pass-2 fallback in
`flushSqliteBatch` (`presentation.ts:1389-1393`) writes the first surviving alias as a new row
under its own id, while the session keeps the old `syncId`. A later delete of that alias closes a
junction under the old id, which misses, so it resurrects on reopen, and the remaining member shows
as synced with it.

## Class 2: an id that is already persisted gets re-added, and the save treats it as brand new

**The pattern.** The subscriber records any id that newly appears on a slide as added
(`presentation.ts:1793-1805`, `1856-1862`), whatever brought it back. Undo, redo and promote bring
back ids whose rows and junctions already exist or were only closed. Pass 1 then calls
`db_add_element`, which always INSERTs a row and a junction (`storage.rs:1238-1262`), and
`db_add_slide` always INSERTs a slide (`1812-1826`). The add/delete cancellation block
(`presentation.ts:1286-1318`) is written on the premise, stated in its comment at `1287-1289`,
that "a never-flushed row … has no DB row, so its DELETE is always a no-op". That is false for a
re-add: the delete that preceded it was real. The queues do not record whether a row is persisted,
so the block cannot tell the two cases apart.

**C1. Delete an element, Cmd+Z, within one 1s debounce.** *CONFIRMED* (probe `C1`). Delete and
undo are not sync/link actions, so under the current code both still ride the debounce, and
undoing a delete right away is a reflex. Expected on reopen: the slide as before. Actual: `B`
appears twice, and both copies show as synced because the row now has two junctions. The DB has
two current rows `B` and two current `(S0, B)` junctions. Severity: wrong sync state and duplicated
content. This is one of the ways an element that was never synced "comes back synced".

**C2. Delete a slide, Cmd+Z, within one debounce.** *CONFIRMED* (probe `C2`). On reopen the slide
appears twice, and each copy has every element twice, all marked synced. Severity: data corruption.

**C4 / C5. Delete, Cmd+Z, Cmd+Shift+Z within one debounce.** *CONFIRMED* (probe `C4`, `C5`). The
redo's delete is cancelled against the undo's add, so the deletion never reaches the DB. The
element (C4) or slide (C5) is back on reopen. Severity: data loss (resurrect).

**C3 / C6. Delete, autosave, Cmd+Z (or free, autosave, Cmd+Z).** *CONFIRMED* on the real app (C3:
two current rows `B`, nothing visible on reopen). **It is also in David's deck**: at
2026-09-15T00:27:52.575 slide `9b221f3f` was deleted (flushed), and at 00:27:55.081 it was re-added
by an undo. Its two elements (`06b8f832` demo, `83733434` text) now each have two current rows. Had
the undo come within 1s, that slide would have reopened doubled, as in C2. Severity: latent DB
corruption. It is invisible while the rows agree, and the loader keeps whichever row it reads last.

**U2. Duplicate, free the copy, Cmd+Z, Cmd+Z.** *CONFIRMED on current code, CLEAN under the
pre-006d924 emulation.* The free is flushed at once. The two undos land in one batch: the first
re-adds the alias `(dupSlide, A)`, and the second deletes the duplicate slide. Deletes run before
adds (`presentation.ts:1321-1395`), and the cancellation block only drops adds for slides that were
added and deleted in the same batch. So the add writes a junction `(deadSlide, A)` after the slide
was closed. The loader counts junctions on dead slides when it derives `syncId`
(`storage.rs:1064-1071`, `1103-1108`), so the ORIGINAL `A`, which is alone on one live slide, comes
back synced. Severity: wrong sync state, and a #191-shaped symptom (see below).

**FUR. Free, Cmd+Z, Cmd+Shift+Z within one debounce.** *CONFIRMED under the pre-006d924
emulation* (probe `FUR` with `flushSyncLinkNow` disabled). On reopen the slide has both the freed
copy and a synced copy of the group. Under current code the free flushes first, and what is left
is only a duplicate current row for the freed id. Severity: wrong sync state (old behaviour).

## Class 3: the session holds states that one row per group cannot represent

**The pattern.** Storage has one row per group with one `link_id`, and at most one live junction
per (slide, row) because `db_add_element_to_slide` skips an existing one (`storage.rs:1272-1295`).
The session lets instances of the same group differ in `linkId`, lets two instances of one group
sit on one slide, and lets a pasted member carry different data. Nothing stops these states from
being created.

**A1. Unlink one synced instance.** *CONFIRMED* (probe `A1`). The "Unlink Animation" context menu
(`SlideElementRenderer.tsx:1338-1344`), the A badge (`1647-1651`) and the inspector's Unlink and
Unlink All buttons (`PropertiesPanel.tsx:904`, `241`) are all offered on synced elements. Unlinking
the slide-2 instance leaves its peers linked in the session. On reopen it is linked again, because
the alias write was a no-op. Unlinking the canonical instance instead (harness `A2`) unlinks the
WHOLE group on reopen. The same thing happens without the UI: free, unlink, resync gives a rejoined
member with no link (harness-only). Severity: wrong link state.

**B1. Paste a synced clip onto a slide that already holds that group, or paste it twice.**
*CONFIRMED* (probe `B1`; harness `B2` shows the paste-twice case). `pasteElementDelta`
(`syncLink.ts:107-115`) decides "join" by comparing the target slide with the clip's source slide.
It never checks whether the target slide already has a member of that group. The second junction
is skipped, so reopen shows one instance where the session showed two. Deleting either one closes
the only junction. Severity: data loss (small).

**P1. Copy a synced element, edit the group, paste elsewhere.** *CONFIRMED* (probe `P1`). The paste
joins the group but keeps the clip's copy-time data. The session shows the pasted member as "A"
while its group says EDITED, which breaks the "synced members are identical" invariant. On reopen
it silently turns into EDITED. `resyncElement` got the same fix in #192 (adopt the group's data).
The paste-join path did not.

**R1. Promote a link group that has two members on one slide.** *CONFIRMED* (probe `R1`). Add N on
slide 1 (which already holds P with linkId K) and link N to Q. `linkPairDeltas` merges N into Q's
group K (`syncLink.ts:131-146`, `presentation.ts:739-758`), so K now has two members on slide 1.
Promoting N rewrites every element carrying K into `{...master, id: N}` (`presentation.ts:794-797`).
The session then has two elements with id `N` on one slide, and reopen shows one. In the harness,
promote also rewrites still-synced peers that carry the dormant link id `freeElement` gives them
(`presentation.ts:627-631`). That replaces a different sync group's content with the master's and
can put two copies of the master on its own slide. Severity: corrupt session state.

**U1 / U3. Paste a synced clip after its group has dissolved.** *CONFIRMED* (probe `U1`, `U3`).
Duplicate a slide, copy the synced copy, then undo the duplicate (U1) or delete the duplicate slide
(U3), then paste the clip on another slide. The original `A` is unsynced in the session. The paste
still carries `syncId: A` from copy time, so the flush writes a junction to row `A`. On reopen, `A`
and the paste are synced. Severity: wrong sync state, with the #191 symptom: an element that is
not synced in the session is synced after reopen.

## Class 4: junction z-order is not maintained

**Z2. Delete an element, then add one on the same slide.** *CONFIRMED* (probe `Z2`).
`dirtyZOrder` is set only when a slide's element count is unchanged and ids moved
(`presentation.ts:1887-1896`). A delete leaves a gap, and an add takes the current index as its z
(`1859`), which can equal a stale z. The loader orders by `slide_id, z_order`
(`storage.rs:1055`), so the tie is broken by SQLite's scan order, and the new element came out
first. David's deck had a tie of the same kind at the time of #191 (the legend and demo piece
`bda5f3` were both z 4 on slide `3e30aa` from 15:11:16 to 15:12:31). Severity: cosmetic (stacking
order).

## Class 5: remembered ids are dropped by the incremental save

**RM.** *CONFIRMED* (probe `F2`/`D1` output: the session has `_syncId`, the reopen does not).
`addElementRow` and the dirty loop strip `_syncId` and `_linkId` from the saved data
(`presentation.ts:1352`, `1412`). `db_import_json` keeps them, and the storage test
`test_import_promotes_live_ids_but_preserves_remembered_ids` calls them "ordinary persisted element
state" that "must survive Save As" (`storage.rs:4044-4078`). So a freed or unlinked element cannot
be re-synced or re-linked after a reopen, and its grey S or A badge disappears. The #192 resync
works only within one session. Severity: wrong sync state (the ability to rejoin is lost).

## Class 6: batch ordering and a loader that counts dead junctions

Within one flush, deletes run before adds, and adds are only cancelled for slides that were added
and deleted in that same batch. An element added to a slide that is deleted in the same batch gets
a junction on a dead slide (harness: free or resync followed by deleting that slide inside one
debounce under the old batched save; real app: U2). Separately, `build_presentation_value` counts junctions on dead slides toward `syncId`
(`storage.rs:1064-1071`, `1103-1108`), which turns such a junction into a spurious sync. These
effects appear only together with class 2, which is why U2 is listed as class 2+6.

## Class 7: durability (#190 class), introduced by 006d924

**W1. A free stays in the WAL.** *CONFIRMED on current code, CLEAN under the pre-006d924
emulation.* The test frees an instance, waits 4s without saving, and copies only the main
`.eigendeck` file, as a cloud sync or a plain copy would, while the app is still open. The main
file still has the junction to G. `flushSyncLinkNow` calls `flushToSqlite`, which cancels the
pending debounce timer (`presentation.ts:1486`). The `db_checkpoint` in `scheduleFlush`
(`1511-1518`) never runs, so the change stays in the WAL until some later debounced edit, a Save
(which checkpoints since #190, confirmed by `W2`) or a clean close. The control `W0` shows that a
debounced edit reaches the main file. Under the old code the free rode the debounce and was
checkpointed after 1s, unless Cmd+S came first (pre-#190 Save did not checkpoint). Severity: the
free reverts on any machine that reads the main file. This is a direct "unsynced, then synced
again elsewhere" mechanism.

## Incidental: undo leaves the slide index out of range

**IDX.** *CONFIRMED* (probe `IDX`: `currentSlideIndex` 3 with 3 slides). Undo restores
`presentation` only (`partialize`, `presentation.ts:981-983`), and `followUndoChange` returns early
when the current slide "changed" to undefined (`1077`). In the harness, the next `addElement` or
paste threw `Cannot read properties of undefined (reading 'elements')`. This is not persistence and
has no probe beyond IDX.

## #191: not reproduced; what the deck shows

**Not reproduced**, under either save behaviour, with the recollected sequence. The probes `DAVF`
and `DAVS` (copy A, paste on another slide = link, duplicate that slide, free the pasted copy on
the duplicate, paste the clip on a third slide) and `DAV2F`/`DAV2S` (the same, but copying the
synced copy before freeing it, fast and at a 1.5s human pace) are all CLEAN on current code and on
the pre-006d924 emulation. In the harness, 4,800 random sequences built only from the recollected
op set (select, copy, paste, duplicate, build, free, resync, move, edit, z, link, flush) on a
fixture shaped like David's slides produced no "unsynced came back synced" at all. Every sequence
that did produce it involved undo, delete, or a stale clip (C1, C2, U1, U2, U3, FUR and relatives).

**What the deck history shows** (read-only copy, `immutable=1`):

- The legend is row `5fecc887`. It was created at 15:11:16.619 by a cross-slide paste from
  `fd306469` on slide 16 (both rows got link `f3570c…`). It was added to `3bb6e3` at 15:11:42.603
  (duplicate slide), to `cf5f1f` at 15:42:57.653 (a junction-only add, i.e. a paste of a clip that
  carried `syncId 5fecc887`), and to `ae30eb` at 16:53:32.536 (duplicate slide). All four junctions
  are current and on live slides. The only other junction events are z-order rewrites on `3e30aa`
  at 15:12:31.427 and on `ae30eb` at 16:58:40.770.
- **No free of the legend ever reached the main file.** No row other than `5fecc887` and `fd306469`
  ever held the legend's html. The earlier analysis is correct on this point. The two z-order
  rewrites belong to other frees in the same batch: at 15:12:31 the demo piece `bda5f3` was freed
  on `3e30aa` (new row `0a6861`, same link `ab1acc`), and at 16:58:40 `99154d` was freed on
  `ae30eb` (new row `06790b`, same link `2310af`). A free replaces an element in place, which marks
  the whole slide's z-order dirty, so every junction on that slide was rewritten. Frees did persist
  during that session. The legend's did not.
- **The app never restarted** between 2026-09-14 20:01:05 and at least 09-15 18:22:37. The storage
  timestamp sequence counter is per process, and it runs 0 → 815 without a reset. So the "reload"
  was either a reopen inside that process or happened after the last write.
- The deck carries the class-2 fingerprint (C3 above, 00:27:52 → 00:27:55), so David does undo
  deletions quickly. It has none of the fingerprints of the other "came back synced" mechanisms: no
  duplicate junctions (C1), no junction on a dead slide (U2), no freed row next to a surviving
  junction (FUR), and no extra junction onto a group from an unsynced element (U1/U3).

**Most likely explanations (hypotheses, not proven).** (a) The free was in the WAL and the file that
was reopened or copied was the main `.eigendeck`. `gitignore/source-inversion.eigendeck` has no
`-wal` next to it, and #190 was about a synced copy on a second machine. Under the pre-006d924 code
this needs a Cmd+S within 1s of the free, because Save did not checkpoint before #190 and it
cancels the debounce. Under current code it happens after EVERY free (W1). (b) The free was undone
in the session, for example coalesced into another undo step by the 200ms undo debounce, or
reverted by a quick Cmd+Z. That leaves exactly this fingerprint and is not a persistence bug.
Neither can be told apart from the file alone. If David still has the WAL for that deck, or the
copy on his other machine, comparing the two would settle (a).

## Where docs/sync-and-link.md disagrees with the code

- "Canonical id and in-session instances" presents the alias no-op in `db_update_element` as safe
  because "the canonical write already persisted the shared data". Class 1 is every case where no
  canonical instance exists to make that write.
- The Store API table and the text around it say `freeElement`/`resyncElement` are "thin wrappers"
  that "route through updateElement". Both now mint new ids and bypass `updateElement`. Free also
  rewrites peers' `linkId`, and resync adopts the group's data. The listed line numbers are stale
  throughout the document (for example `updateElement` is at 525-585, not 403-450).
- `_syncId`/`_linkId` are described as the remembered group "so it can re-sync". The incremental
  save discards them (class 5), while `db_import_json` keeps them.
- Lifecycle step 1 says duplicate and build "clear `_syncId`/`_linkId`". `addBuildSlide` does not
  (`presentation.ts:457-460`), which leaves elements with both `syncId` and `_syncId`.
- "Two elements that share a linkId are different elements on different slides." `linkElements`
  can merge a group that already has a member on the source's slide (R1). The guard comment "links
  are … NEVER on a synced element" (`presentation.ts:723`) is also contradicted by duplicate and
  free, which put link ids on synced peers. Promote then treats those peers as partners.
- Promote is documented as converting "linked instances on other slides". The code converts every
  element carrying the link id on any slide, including the master's own slide and synced elements.
- The paste table says a cross-slide paste of a synced source "joins that sync group". The decision
  is made from the clip's copy-time state (U1/U3), ignores whether the target slide already has a
  member (B1), and keeps the clip's data (P1).
- The Export section says `syncId` is derived when a row is "shown on multiple slides". The loader
  counts junctions on dead slides too (U2).
- The storage section describes `db_import_json` as the inverse of the loader, which reads as if it
  were the reopen path. Reopen is `db_open` + `db_load_presentation` only, and the incremental
  writer does not follow import's rules (dedup, keeping remembered ids).

## What was checked and turned out fine

The following re-checks of `.claude/notes/autonomous-e2e-findings.md` are now clean in the harness:
S1a (duplicate, delete the copy, in `every` and `batched`), S5b (free the copy in the same
session), S5c (settled free + move), S8 (z-order on a same-session copy), S8b (duplicate, then
delete the duplicate slide in one batch), S9 (linking twice from one anchor builds one group) and
S2 (resync snaps to the group). S1b's delete persists; its leftover is the class-1 alias (the
copy's link reappears), and the recording part was not tested (no notebooks here). S10 (cross-type
link) is now blocked by `linkElements`. #192 is clean within a session (free → move → resync in
`syncnow`). After a reopen, resync is impossible because of class 5.

On the real app these were CLEAN: DAVF, DAVS, DAV2F and DAV2S on both behaviours, U2 on the old
behaviour, W0 (a debounced edit reaches the main file) and W2 (Cmd+S checkpoints). Cross-session
undo seeding (`seedUndoHistory` with a faithful `db_get_state_at`) was fuzzed as well. It found
nothing beyond the classes above.

Discovery fuzzing with every known trigger suppressed (`HUNT_AVOID=undo,delete,unlinkSynced,
pasteJoin,promote,preflush`) found only more instances of classes 1, 3 and 4 (free or resync of the
canonical instance, free → unlink → resync, two members on one slide via resync, z ties). No new
class appeared.

Not covered: notebook overlays and recordings, assets, multi-select actions (Unsync All was reasoned
about but not driven), the native macOS clipboard, and real OS crash timing. `db_update_slide`
throwing mid-batch would re-queue and re-run structural adds (`presentation.ts:1464-1478`). That
would create duplicates, but no trigger was found, so it is only a hypothesis.

## Files

- `src/store/syncHunt.test.ts`: harness, named scenarios and fuzzer.
- `e2e/sync-hunt-probe.mjs`: real-app confirmation probe.
- `e2e/sync-hunt-fixtures.mjs`: fixture builder for the probe.
