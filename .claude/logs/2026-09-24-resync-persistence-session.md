# Bug triage process, export numbering, asset durability, resync regression — 2026-09-17 → 09-24

This arc picks up after the 2026-09-16 log. It covers a change in how bug reports
are handled, three fixes on `main`, and a sync regression found by the weekly
coverage run and fixed on the branch `fix/resync-persistence`.

## How bug reports are handled now

David pointed out that none of the bugs he had reported in the previous session
had reached GitHub; they had only been written to auto-memory, which he cannot see
and which is not a tracker. The new `bug-triage` skill (7b6d0f7) sets the order:
file a record-only GitHub issue first, in the reporter's words, then build a
reproduction (usually an e2e probe) before reading code, then weigh fixes and their
cross-mode implications, and bring the tradeoffs back when a fix is not trivial. It
also says to claim a bug fixed only when the reported scenario itself is reproduced
and verified. The backlog was filed as #187 through #191.

## Export slide numbers (#187, fixed in 97ab31a)

The exported website and the printable/PDF export numbered footers from the raw
slide index, so a build (slides sharing a `groupId`) was renumbered as separate
slides. Both export paths bypassed `getSlideNumber`, which lived in a `.ts` file the
`.mjs` export code could not import. It now lives in the shared `src/lib/slideGroups.mjs`
and is re-exported from `types/presentation.ts`, so all four numbering sites agree.

## Watched-asset durability (#190, fixed in c68f314, issue left open)

David saw image v1 on a second machine after the watched source had reloaded to v2
on the first. The first probe copied only the main `.eigendeck` file mid-session,
which is what a sync service grabs. It showed that a watched-asset reload writes to
the WAL but, unlike a presentation edit, schedules no checkpoint, so the new bytes
never reached the main file until an unrelated edit or the close. David asked
whether the probe was waiting out the 1s debounce, and it was not. The reworked
probe waits properly and still shows the reload stranded, while an unrelated edit
rescues it. His exact scenario (save, graceful close, wipe the trust ledger, reopen)
came back v2, so the close path was already durable and the machine-2 loss was a
sync race. Cmd+S did not help because `saveProject` did not checkpoint. The fix makes
a reload checkpoint and mark the deck dirty, and makes Save checkpoint. It is guarded
by `asset-durability-probe` and `asset-durability-close-probe`. The real fs-watcher
path still has no headless integration guard, so #190 stays open for confirmation on
real machines.

## Resync regression (#192, fixed on the branch)

The weekly E2E Coverage job failed on `resync-position-probe`; the week before it
had failed on the demo-theme path bug. The probe had passed on 09-14 and the break
bisected to 006d924, the immediate sync/link flush from the previous session.

An element is synced when it is referenced by more than one slide, which is stored
as one `elements` row with several `slide_elements` junctions. Freeing an instance
gives it its own id, so the save writes it its own row and junction. Resync should
reverse that and point the slide back at the group's row. `resyncElement` only
restored `syncId` and kept the freed id, so the save saw a content update on the
freed row and never repointed the junction. Before 006d924 this worked by accident,
because free and resync landed in one flush and the batch's add/delete cancellation
erased the freed row before it was written. Once free flushed immediately, there was
nothing left to cancel.

Resync now mirrors free. It mints a fresh instance id carrying the group's `syncId`,
so the save closes the freed junction and adds a junction-only reference to the
group's existing row. The freed row is left unreferenced, the same as after any
element delete, and `compact` reclaims it. Restoring the group's own id was
considered and rejected, because `db_add_element` always inserts and would have
created a second current row. Following the 2026-06 decision that resync means "the
same element again", the instance now adopts the group's content as well as its
position (0c28970). The durability probe and the resync probe both pass. A naive
revert of 006d924 would have traded one for the other.

David found `db_export_json` a confusing name, since it is the loader
`openSqliteProject` calls right after `db_open` and reopen does no separate import.
It is now `db_load_presentation` (285bca9); `db_export_json_with_assets` is a real
export and kept its name.

We missed the regression for a week because the full e2e suite runs only on the
weekly schedule. `ci.yml` runs typecheck, vitest, clippy and the Rust tests, none of
which exercise a save-and-reopen round trip. Gating the sync and persistence probes
on PRs is the open follow-up on #192.

## Reprovisioning after the container reset

The reset wiped `~/.cargo`, the GTK/WebKit dev libraries, `~/el-target`, the e2e
tools and the pdfium copy. Recovery was rustup, the apt packages from AGENTS.md plus
`xvfb` and `webkit2gtk-driver`, `cargo install tauri-driver`, a seam build of
`dist/`, and copying `libpdfium.so` to `/usr/lib/Eigendeck/resources/pdfium/`.
Without that last step `asset-layer-probe` fails on its PDF step. `run-all.sh`
reads the CLI path from `E2E_CLI`; passing `CLI` instead makes nearly every probe
fail at setup. On this branch the full suite passes 130 of 130.

## Still open

#191 (David's unsync reverting after a save and reload) is still not reproduced. It
involves free, not resync, so 0c28970 does not claim to fix it. #188 (cut and paste
of demos) has a passing logic-level guard, `e2e/demo-copypaste-probe.mjs`, now in
`run-all.sh`. It dispatches the clipboard events directly, so it does not cover the
keyboard path, and that is where the working theory lives: that no `cut` listener exists and that a
focused demo iframe takes Cmd+C and Cmd+V away from the parent. #189 (demo pieces on
reload) has not been investigated. `cargo fmt --check` reports 452 lines of drift
across the crate. That drift predates this work, and CI does not run the check.
