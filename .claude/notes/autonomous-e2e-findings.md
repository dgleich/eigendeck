# Autonomous E2E exploration — findings log

Agent-driven adversarial testing of the sync/link/notebook/paste/promote/watch
features on `feat/notebook-recording`. Each entry: scenario, steps, expected vs
actual, severity (BUG / SUSPECT / OK-note), and a minimal repro.

Started: (overnight run)

---

## S1a — Delete a duplicated (synced) instance → it RESURRECTS on reload  **BUG**

**Steps** (deck = one notebook `nb1` w/ recording MARK_A on slide 1):
1. `duplicateSlide(0)` → notebook now on slide 1 (id `nb1`, syncId `nb1`) and slide 2 (fresh in-session id, syncId `nb1`).
2. `selectSlide(1); deleteElement(<copy id>)` — in-session slide 2 now has 0 elements (correct: `after=[1,0]`).
3. `flush(); save()`; quit.
4. Reopen fresh.

**Expected:** slide 2 has no notebook; one element remains (slide 1), no syncId (single junction).
**ACTUAL:** reopened deck has the notebook on BOTH slides again (`reopenSlideCounts=[1,1]`, both `syncId=nb1`). The delete did NOT persist — the element resurrects.

**Root cause:** `subscribe` diff records `deletedElements.set(pel.id, slideId)` using the **in-session instance id** (a fresh UUID for the duplicated copy). But in the DB the slide-2 junction was written by `db_add_element_to_slide` with the **canonical** element id (`nb1`), not the copy's UUID (see `flushToSqlite` add-element path, presentation.ts:845-850). So `db_remove_element_from_slide(slide2, <freshUUID>)` (storage.rs:1281) matches NO junction (`WHERE element_id = <freshUUID>` finds nothing) → junction survives → element reappears.

**Severity: BUG** (data loss inverse — a delete is silently undone by reload; user thinks they removed a slide's mirror but it's still there next open). In-session it looks deleted, masking the bug until reopen.

**Minimal repro:** `/tmp/mk_nb_single.py` deck + `/tmp/p_del_synced.mjs` (DEL_WHICH=second). Also reproduces with a plain text element (not notebook-specific) — the junction-id mismatch is type-agnostic.

## S1b — Delete the CANONICAL instance of a fresh sync group → recording orphaned (lost)  **BUG**

**Steps** (same deck; recording MARK_A owned by element `nb1`):
1. `duplicateSlide(0)` → slide1 inst id=`nb1` (canonical, owns overlay), slide2 inst id=`<copyUUID>`, both syncId=`nb1`.
2. `selectSlide(0); deleteElement('nb1')` — delete the canonical instance. (in-session `after=[0,1]`.)
3. flush+save; quit; reopen.

**Expected:** the surviving instance keeps the recording (MARK_A) — it's the same synced element, just shown on one slide now.
**ACTUAL:** `recordingSurvived=false`. Reopened: slide2 has a notebook with a NEW row id (`<copyUUID>`), `syncId=undefined`, and the overlay asset `ov-nb1` is still `owner: 'nb1'` → orphaned. MARK_A is gone.

**Root cause:** in the same flush, the canonical `nb1` junction is removed (deletion phase) BEFORE the added copy is processed. By then no live element with `syncId=nb1` exists that isn't itself in `addedElements`, so flush writes the copy as a brand-new `elements` row (`<copyUUID>`) instead of a junction to the canonical `nb1` row. The recording (overlay owned by `nb1`) is never re-owned to `<copyUUID>` → unreachable at the survivor's live key (`syncId??id` = `<copyUUID>`). The original `nb1` row is left with no valid junction.

Note: in this canonical-id case the *delete itself* persists correctly (because the deleted id matches the DB row id) — contrast S1a where deleting the NON-canonical instance doesn't persist at all. So the two halves of "delete one synced instance" fail in opposite, complementary ways:
- delete non-canonical → delete is a no-op on reload (element resurrects) [S1a]
- delete canonical → delete persists but recording is orphaned + survivor desyncs [S1b]

**Severity: BUG** (recording data loss + sync-group desync on a normal delete).

**Repro:** `/tmp/p_del_synced.mjs` DEL_WHICH=first on `/tmp/nb1.eigendeck`.

### S1a/S1b refinement — trigger is "duplicate → delete → save with NO intervening save"
Re-tested the SETTLED path (`/tmp/p_del_settled.mjs`): duplicate → save → quit → reopen (junctions now real, both instances re-load with the same canonical id `nb1`) → delete either instance → save → reopen. That path is CORRECT both ways (`reopenCounts=[1,0]`/`[0,1]`, recording survives). 

So S1a (resurrect) and S1b (orphaned recording) reproduce ONLY when the duplicate and the delete land in the **same flush** (no save between duplicate and delete). That is still a realistic sequence — duplicate a slide, delete a mirror you didn't want, then save/autosave — and the result is silently wrong on next open. The in-session id of a freshly-duplicated instance (a UUID ≠ canonical id) never reaches the DB as a junction id, so a delete keyed on it is a no-op, and a same-flush delete of the canonical instance makes flush re-materialize the copy as a new detached row. **Both remain BUGs**, just with the precise precondition noted.

## S2 — Free → move → resync leaves synced instances at DIFFERENT positions  **SUSPECT**

**Steps** (notebook nb1, duplicated): free slide-2 instance, move it +200x (slide1 stays — correct), then `resyncElement`.
**Expected** (per docs/sync-and-link.md: "synced instances mirror position by construction… there is no synced-content-but-free-position state"): on resync the instance should re-mirror the group's position.
**ACTUAL:** after resync the group is at x=[60, 260] — two synced instances at DIFFERENT x. `resyncElement` only flips `_syncId→syncId`; it does NOT reconcile position. Then moving one moves BOTH but they stay permanently offset by 200 (`[70,270]` after a +10 move) — a standing violation of the "same position" invariant.

On save+reopen the divergence is silently discarded: import dedups same-syncId members only if data/position are IDENTICAL, else treats them as animation frames. Here it collapsed both to the canonical x=60 (`FMR_REOPEN` both x=60), so slide-2's 260 is lost. So the **in-session** state (diverged, both syncId) and the **persisted** state (snapped to 60) disagree — and a user who freed→moved→resynced loses the move silently, or (if it had been kept as an animation frame) would get an unexpected extra row.

**Severity: SUSPECT** — resync arguably should either snap position to the canonical immediately (so in-session matches what reload will do) or reconcile to the moved value; right now it does neither and leaves an inconsistent group. Needs a human call on intended reconcile semantics.

**Repro:** `/tmp/p_free_move_resync.mjs` and `/tmp/p_resync_move.mjs` on `/tmp/nb1.eigendeck`.

## S4 — Copy/paste matrix  **OK**
- Cross-slide paste of a SYNCED notebook onto a 3rd (blank) slide JOINS the sync group: in-session all 3 instances `syncId=nb1`; after save+reopen ONE entry (`id=nb1`) across all 3 slides; recording (MARK_A) shows on the pasted slide. (`/tmp/p_paste_into_sync.mjs`) ✓
- Same-slide paste → detached independent copy, +40 offset (verified separately; afterPaste=2 elements). ✓
- copypaste-reload (cross-slide unsynced → linked copy carries recording) — already covered by `e2e/copypaste-reload.mjs`. ✓

## S7 — Undo/redo across link/promote/free/paste  **OK (with coalescing caveat)**
- undo paste: elements 2→1, redo→2. ✓
- undo free: `_syncId` reverts to `syncId` on the freed instance; peer untouched. ✓
- link → (debounce) → promote → undo: depth=2; undo#1 lands in the LINKED state, undo#2 in the original detached state; redo restores. Clean — no id desync (#30 not reproduced). (`/tmp/p_undo_promote2.mjs`) ✓
- **CAVEAT/SUSPECT-lite:** when `linkElements` and `promoteToSync` fire back-to-back with NO debounce gap, zundo COALESCES them into ONE undo step, so a single undo jumps all the way from synced → fully-detached (skipping the linked state). Likely intended zundo time-coalescing, but worth a human glance since promote is a destructive op a user may want to undo discretely. (`/tmp/p_undo.mjs` UNDO_MODE=promote)

## S5b — Free an instance right after duplicate (no save between) is LOST on reload  **BUG**

**Steps** (notebook nb1 w/ rich overlay):
1. `duplicateSlide(0)` → slide1 `nb1`(syncId nb1), slide2 copy `da47…`(syncId nb1), shared overlay.
2. `selectSlide(1); freeElement(da47…)` → in-session copy becomes `{syncId:undefined,_syncId:nb1,linkId:L}`; the onFree hook CLONES the overlay to the copy's new key (verified: 2 overlay assets owned by `nb1` and `da47…`).
3. `flush(); save()`; quit; reopen.

**Expected:** slide2 is a SEPARATE row (`id=da47…`, no syncId, shares linkId) — a freed animation frame; its cloned overlay reachable.
**ACTUAL:** reopened deck has ONE entry: both slides `{id:nb1, syncId:nb1}` (re-merged). The free is GONE. The copy was persisted as a junction to `nb1`, not as its own row. The cloned overlay (`owner: da47…`) is now ORPHANED (no element has that live key).

**Root cause:** `flushToSqlite` add-element path reads `info.element.syncId` from the snapshot captured **when the element first appeared** (subscribe records `addedElements.set(id,{element})` only on first sighting, presentation.ts:1216). The later `freeElement` goes through the "changed" branch (`markElementDirty`) and does NOT update the `addedElements` snapshot. So at flush time `el.syncId` is the STALE `nb1` → flush matches the canonical and writes a junction instead of a fresh row (presentation.ts:828-850). Any sync/link transition (free/unlink/relink/resync) on a never-yet-flushed added element is silently dropped on save.

**Severity: BUG** (data loss: a freed animation frame collapses back into the sync group on reload; cloned recording orphaned). Companion to S1a/S1b — same "added element snapshot is stale until first save" class.

**Repro:** `/tmp/p_overlay_clone.mjs` on `/tmp/rich.eigendeck`; structure confirmed with `/tmp/p_dbdump.mjs` (one `nb1` entry on both slides post-save).

## S5c / S2-core — duplicate→free→move→animate does NOT survive save/reopen (settled too)  **BUG (high)**

This is the canonical animation workflow from docs/sync-and-link.md ("Lifecycle: duplicate → free → move → animate") and it is NOT persisted, even when the group was previously saved/reloaded (settled).

**Steps:** duplicate slide → SAVE → reopen (settled) → on slide2 `freeElement` → `moveElementsBy(+300x)` → save → reopen.
**Expected:** slide2 is a separate `elements` row at x=360 with no syncId, sharing only `linkId` (an animation frame, #32); presenter animates slide1→slide2.
**ACTUAL** (`/tmp/p_free_settled.mjs`): reopened deck is ONE entry, both slides `{id:nb1, sync:nb1, x:60}`. The free AND the move are both lost.

**Why** (`/tmp/p_free_settled_dbg.mjs`): after a reload, ALL synced instances share the SAME in-session `id` (= canonical `nb1`) — only one DB row exists. In-session the free/move are applied correctly to the slide2 instance object (`afterMove`: slide1 `{id:nb1,_sync:nb1,x:360}`, slide0 `{id:nb1,sync:nb1,x:60}`). But `flushToSqlite`'s dirty-element loop does `slide.elements.find(e=>e.id===elementId)` and `break`s on the FIRST match (presentation.ts:881-895) — so for id `nb1` it writes slide0's data (x=60, still synced) and the freed instance's distinct row is never created. On reopen the single `nb1` row with two junctions re-derives syncId → re-merged.

So a freed-after-reload instance can never become its own row: the flush has no way to address it (shared id) and overwrites with a sibling's data. Contrast the same-session free (S5b) which fails for a *different* reason (stale added-element snapshot). **Net: the freed-position animation workflow does not persist by either path.**

**Severity: BUG (high)** — the headline animation feature silently doesn't round-trip; the user frees+positions an element for a slide transition, saves, reopens, and it's snapped back together.

**Repro:** `/tmp/p_free_settled.mjs` + `/tmp/p_free_settled_dbg.mjs` on `/tmp/nb1.eigendeck` (also reproduces with a text deck — shared-id-on-reload is type-agnostic).

### S5c confirmation — also text-only, first session (distinct ids)
`/tmp/p_free_firstsess.mjs` on a TEXT deck: in-session the freed copy has a DISTINCT id (`131f…`, syncId undefined, x=400) — perfect. On reopen: both `{id:A, sync:A, x:100}` — re-merged, free+move lost. So the breakage spans BOTH triggers (same-session stale snapshot AND settled shared-id) and BOTH element types. The duplicate→free→move animation workflow does not persist in any tested configuration.

## S6 — File-watch  **OK**
- Two notebook elements (nbA slide1, nbB slide2) sharing ONE external `.ipynb`: mutating the file reloads BOTH (per-asset watch). `nbA_reloaded=true`, `nbB_updated=true`, `nbB_stillInit=false`. (`/tmp/p_shared_watch.mjs` + `/tmp/mk_shared_ipynb.py`) ✓
- Full take-control / reload-from-disk / re-enable-watch workflow: covered by `e2e/notebook-watch-takecontrol-probe.mjs` (re-run below). ✓

## S9 — Linking a 3rd element to an already-linked source STRANDS the first partner  **BUG**

**Steps** (3 notebooks nb1/nb2/nb3 on 3 slides, recordings M1/M2/M3):
1. `linkElements('nb1', 1, 'nb2')` → nb1 & nb2 share linkId `L1` (correct).
2. `linkElements('nb1', 2, 'nb3')` → expected: nb3 JOINS nb1's group (all three share `L1`).
   **ACTUAL:** nb1 & nb3 get a BRAND-NEW linkId `L2`; nb2 is left on `L1`. The first link is broken — nb2 is stranded.
3. `promoteToSync('nb1')` collapses only the `L2` group (nb1+nb3) → one entry; nb2 stays a separate entry. Reopen: M1 shown, M2 STILL shown (un-merged), M3 discarded.

**Root cause:** `linkPairDeltas(target)` (`syncLink.ts:81-87`) computes `sharedLinkId = target.linkId || target._linkId || newId()` — it only considers the TARGET's existing link group and IGNORES the SOURCE's. So linking an unlinked target to an already-linked source mints a new group and overwrites the source's linkId, abandoning its prior partners. There is no "merge two link groups" path. A user building a 3+-slide animation by repeatedly linking from one anchor element silently loses earlier links.

**Severity: BUG** — cannot build a 3-way (or N-way) animation link from a single anchor; sequential links from the same source clobber each other. Also makes "promote a 3-way link" leave members un-merged.

**Repro:** `/tmp/p_3way_promote.mjs` on `/tmp/3way.eigendeck` (`linked` snapshot shows nb1=L2, nb2=L1, nb3=L2).

### S9 nuance — direction-dependent
Linking TOWARD the anchor works: `linkElements(nb2→nb1)` then `linkElements(nb3→nb1)` yields ONE shared linkId across all 3 (`distinctLinkIds:1`, `/tmp/p_3way_order.mjs`). Only linking FROM the anchor (`linkElements(nb1→nb2)` then `nb1→nb3`) strands the first partner. So the bug is that `linkPairDeltas` honors only the TARGET's existing group, not the SOURCE's — a directionality footgun. The LinkOverlay UI calls `linkElements(source, targetSlideIdx, target)` where `source` is the element whose "L" button you clicked; if a user clicks "L" on the SAME anchor twice to link it to two other slides, the first link is silently lost. **Still a BUG** (UI-reachable, order-dependent silent data loss); the fix is for the shared linkId to prefer source.linkId ?? target.linkId and merge groups.

## S9b — Flush race (rapid edits then immediate quit)  **OK (harness artifact, not a real bug)**
Edits made then an IMMEDIATE WebDriver DELETE-session (hard kill within the 1s flush debounce) lose the uncommitted writes (`border=false…`). But: (a) waiting 2.5s for the debounced `scheduleFlush`→`db_checkpoint` to fire persists them with no explicit save (`/tmp/p_race2.mjs` → `border=true`); and (b) the real app has a `check-close` handler (App.tsx:602-647) that flushes/saves (or prompts) on Cmd+Q / window close. The DELETE-session path is a SIGKILL that bypasses that handler, so this is a test artifact. The DB is opened IN-PLACE (saveProject with a path = just `flushToSqlite`, fileOps.ts:163-169), so debounced writes do reach the file. No real-app data-loss path found here.

## S10 — Mixed element-type link + promote silently destroys the other type  **SUSPECT**

- **Text↔Text promote (OK):** link T1↔T2, promote T1 → one entry (T1 on both slides, same html), survives reopen. No merge-hook crash. ✓
- **Text↔Notebook promote (SUSPECT):** `linkElements('T1'(text), slideIdxNB, 'NB'(notebook))` is ALLOWED, then `promoteToSync('T1')` REPLACES the notebook NB with a copy of the text T1 (slide1 becomes `{id:T1,type:text}` — the notebook is gone, recording orphaned, no merge-hook fires for the type mismatch). Survives reopen as two text instances.

`LinkOverlay.tsx` (the "L" picker) does NOT filter candidates by element type (`otherSlides` lists every element, LinkOverlay.tsx:77-80), so a user can link a text box to a notebook and then promote, silently destroying the notebook + its recording. promote is documented as destructive, but cross-type linking is almost certainly never intended.

**Severity: SUSPECT** — UI-reachable; recommend LinkOverlay filter targets to the SAME element type (and/or promote refuse a cross-type group). Needs a human call. **Repro:** `/tmp/p_mixed.mjs` MIX_MODE=mixed on `/tmp/mixed.eigendeck`.

## S8 — Z-order of synced elements  **BUG (same-session) / OK (settled)**
- In-session, z-order is PER-INSTANCE (not propagated across synced peers) — moving BACK to top on slide2 leaves slide1's order unchanged. (Arguably fine — could be intended per-slide stacking.)
- **Same-session** (duplicate → reorder on the copy → save → reopen): the z-order change is LOST (`Z_REOPEN` both `[BACK,FRONT]`). Same root cause as S1a — the copy's in-session id is a fresh UUID but its DB junction was written with the canonical id, so `db_update_z_order(slide2, freshUUID)` matches no junction.
- **Settled** (duplicate → save → reopen → reorder → save → reopen): z-order persists correctly (`ZS_REOPEN` slide2 `[FRONT,BACK]`). ✓

So: another symptom of the "freshly-duplicated instance's id never reaches the DB as a junction id" bug (S1a family) — z-order edits to a same-session duplicated instance don't persist. **Severity: BUG** (part of the S1a class). Repro: `/tmp/p_zorder.mjs` (fails) vs `/tmp/p_zorder_settled.mjs` (ok).

## S8 — Reorder slides between copy and paste  **OK**
Copy T1 on slide1, `moveSlide(0→2)` (original T1 moves to slide3), then paste onto the now-slide0: the pasted copy links to the CORRECT source (original T1, both share linkId `c87…`), not a wrong element by index. The link tracks the source by captured slide id. (`/tmp/p_reorder_paste.mjs`) ✓

## S1a ESCALATION — autosave timing does NOT save it; the bug is reachable in normal use  **BUG (high)**

Earlier I hypothesized S1a needed duplicate+delete in the SAME flush. Re-tested a realistic flow (`/tmp/p_autosave_flow.mjs`): `duplicateSlide` → WAIT 1.8s (autosave debounce flushes the junction) → `deleteElement(copy)` → WAIT 1.8s (autosave flushes the deletion) → quit → reopen. **Still resurrects** (`AF_REOPEN counts=[1,1]`).

The reason it can't be fixed by timing: a duplicated instance's in-session `id` is a fresh UUID for the ENTIRE session (it is only reconciled to the canonical id by a full close+reopen, see settled tests). So its DB junction is written under the canonical id while the store knows it as the UUID; ANY delete/free/z-order op keyed on the in-session id misses the junction. So **S1a/S5c/S8 same-session failures are reachable in completely normal use**: duplicate a slide, then in the same editing session delete/free/reorder a mirrored element → the change silently doesn't persist (delete/z-order) or collapses back (free). This raises S1a to **high severity** — it's not a contrived same-tick race.

This is the single highest-impact finding: the in-session instance id of a duplicated synced element diverges from its persisted (canonical) junction id, so per-instance structural edits (delete one mirror, free one mirror, reorder one mirror) made before the next reopen do not round-trip.

## S8b — Delete a same-session-duplicated SLIDE resurrects it on reload  **BUG (high)**

**Steps:** `duplicateSlide(0)` (notebook now on slide1+2, synced) → `deleteSlide(1)` (delete the copy's slide) → flush+save → reopen.
**Expected:** 1 slide, the notebook on it (no longer synced).
**ACTUAL** (`/tmp/p_del_slide.mjs`): reopened deck has 2 slides again (`DS_REOPEN slides=2, counts=[1,1], syncId=nb1`) — the deleted slide came BACK.

**Root cause:** the subscribe slide-diff adds the deleted slide id to `deletedSlides` (presentation.ts:1162-1169) but does NOT remove it from `addedSlides`, nor its elements from `addedElements` (which were populated when the slide was duplicated, presentation.ts:1148-1159). In `flushToSqlite`, deletions run FIRST (`db_delete_slide` on a not-yet-persisted slide = no-op), THEN `addedSlides`→`db_add_slide` RE-CREATES the slide and `addedElements` re-adds the junction. So a slide created and deleted within the same session (before its first flush) is resurrected.

Same "stale added-set isn't reconciled against a later delete" class as S1a (which is the element-level version). **Severity: BUG (high)** — deleting a freshly-duplicated slide in normal editing silently doesn't stick.

**Repro:** `/tmp/p_del_slide.mjs` on `/tmp/nb1.eigendeck` (also type-agnostic — would reproduce for any duplicated slide).

## Scope control — content edit + synced move on a same-session copy  **OK**
Same-session duplicate, then `updateElement(copy,{html})` + `moveElementsBy([copy])` (both propagate across the sync group → write the shared canonical row): persist correctly (`EC_REOPEN` both `EDITED_CONTENT, x=150`). (`/tmp/p_edit_copy.mjs`)

**This bounds the bug class precisely:** group-wide DATA edits (content/position/style that propagate to the canonical row via syncId) round-trip fine even same-session. Only per-INSTANCE STRUCTURAL ops that must address ONE mirror distinctly — delete one instance (S1a), delete one instance's slide (S8b), free one instance (S5b/S5c), reorder one instance (S8) — fail, because they're keyed on the duplicated copy's in-session id which never matches its DB junction's (canonical) id until a full reopen reconciles them.

---

# SUMMARY

**Scenarios run:** ~22 distinct probes across all 10 listed scenario areas + invented edge cases (delete-canonical vs non-canonical, settled vs same-session vs autosave-timed, 3-way link directionality, mixed-type link/promote, z-order, slide delete, flush race, empty deck, reorder-between-copy-paste, chooser both cards + reopen, rich overlay, shared-ipynb watch).

**Counts:**
- **BUG: 6** (S1a delete-non-canonical resurrects; S1b delete-canonical orphans recording; S5b/S5c free-after-duplicate not persisted [the duplicate→free→move→animate workflow]; S8 z-order same-session lost; S8b delete-duplicated-slide resurrects; S9 sequential link-from-anchor strands first partner)
- **SUSPECT: 2** (S2 resync leaves diverged positions; S10 cross-type link+promote silently destroys a notebook)
- **OK (verified): ~12** (S4 paste matrix incl. join-sync-group; S6 file-watch + shared-ipynb + take-control; S3 promote chooser both cards + reopen; S7 undo/redo clean when spaced; S8 reorder-between-copy/paste; settled delete/free/z-order all correct; rich overlay round-trip; content-edit+synced-move same-session; empty deck; baselines link-smoke / roundtrip-reload / nb-promote-reload).

**Top 3 suspected bugs (ranked by impact):**

1. **In-session id of a duplicated synced instance diverges from its persisted (canonical) junction id → per-instance structural edits made before the next reopen don't round-trip.** This single root cause produces S1a (delete one mirror → resurrects), S1b (delete canonical mirror → recording orphaned + desync), S8 (reorder one mirror → lost), and S8b (delete a duplicated slide → resurrects). Reachable in completely normal use (duplicate a slide, then delete/reorder a mirror in the same session); autosave timing does NOT help (the UUID divergence is session-long). HIGH. Likely fixes: (a) on duplicate, after the canonical row is materialized, reconcile copies' in-session ids to the canonical id; or (b) in the flush delete/z-order paths, map an in-session id to its canonical (syncId) before issuing `db_remove_element_from_slide`/`db_update_z_order`; and (c) reconcile `addedSlides`/`addedElements` against `deletedSlides`/`deletedElements` in the same flush (drop entries that were added-then-deleted).

2. **duplicate → free → move → animate (the headline animation workflow) does not survive save/reopen** (S5c/S5b). After reload, synced instances SHARE one in-session id, so a freed/moved instance can't be written as its own row — `flushToSqlite`'s dirty loop writes whichever sibling it finds first; the freed frame collapses back into the sync group and the move is lost. Cloned overlay orphaned. HIGH — silently breaks the documented core feature.

3. **Sequential link from one anchor strands the first partner** (S9): `linkElements(A→B)` then `linkElements(A→C)` mints a new linkId for A+C and abandons B, because `linkPairDeltas` keys the shared linkId off the TARGET's group only. Can't build a 3+-way animation from one anchor via the "L" button; promote then leaves members un-merged. MEDIUM-HIGH.

**Honorable mention:** S2 resync leaves a sync group at two different positions (invariant violation, silently snapped on reload); S10 cross-type link+promote destroys a notebook (LinkOverlay doesn't filter by type).
