# Bugs worked through this session — asset / watcher / element area

For the asset model refactor (per-element version pinning, simplified
cascade, dropped src/demoSrc, asset GC). Captured as context for
brainstorming whether implicit NULL-state on `element.assetVersionId`
is bug-prone enough to warrant an explicit boolean.

Branch: `svg-pdf-image-cache`. Current state: just discussed the
refactor design; no refactor code shipped yet. Bugs below were on
the pre-refactor design (forking-based per-element divergence) and
its supporting infrastructure.

## Core distinction (user's framing)
- **Assets watch files.** The file watcher subscribes to disk
  changes, runs `db_store_asset` to add a new version to the asset.
- **Elements watch assets.** An element references an asset_id and
  renders whatever bytes are currently bound. "Pinning" makes the
  element ignore further asset changes.

## Bugs we hit, grouped by theme

### Implicit-state confusion (the theme to focus on)

**B-WIPE-SUBSCRIBERS:** WatcherRegistry tracked subscribers by
`Map<assetId, info>` — keyed only by asset_id, no element-level
tracking. When the same asset_id appeared on 3 slides, all 3
hooks called addRef idempotently; one hook's cleanup (slide 2's,
which had been forked away) called `removeRef(externalRel, A)` →
`entry.assets.delete(A)` → `assets.size === 0` → `unwatch()`.
Slides 1+3 had no separate tracking; the registry lost the
watcher entirely. Result: file mutate → nothing updated for any
slide. Fix: per-element subscribers Set<elementId>.

**B-ASSETID-PATH-LOOKUP:** `db_store_asset` without explicit
asset_id fell back to "look up by path." When the user picked
"Revert + add as new" on a colliding asset, the new bytes were
written via `db_store_asset` without an explicit asset_id → path
lookup found the asset we just restored → reused that asset_id →
silently overwrote the restore. Net: both new and old elements
showed the new bytes; restore appeared to "do nothing." Also:
since both elements were bound to the same asset_id, a later
manual Restore propagated everywhere. Fix: caller generates
`crypto.randomUUID()` explicitly to force the "use this asset_id"
branch. Footgun comment in storage.rs.

**B-COMPARE-CURRENT-VS-NEW:** First version of the collision
dialog compared `existing.currentHash` vs `existing.originalHash`.
This only catches divergence caused by silent watcher updates —
misses the auto-reload-off case where the file diverged but the
asset stayed at original. Fix: compare new bytes vs original.

### State-inheriting-from-files bugs

**B-IMPORT-JSON-MISSED-TABLES:** `db_import_json` wiped slides/
elements/presentation/slide_elements but left assets, asset_cache,
math_cache, and `_meta.project_id` intact. "New Project" picking
an existing filename inherited the old project's asset history.
Fix: extend wipe to ALL per-project tables. Added explicit
PER_PROJECT_TABLES const + regression test that cross-checks
sqlite_master against the const (catches future schema additions
that forget to update the wipe list).

**B-SCHEMA-INDEX-BEFORE-MIGRATION:** v3 schema's `CREATE INDEX ...
ON assets(asset_id)` ran in the same `execute_batch` as the
table definitions, BEFORE the v2→v3 migration that adds the
asset_id column. Old files: `CREATE TABLE IF NOT EXISTS` no-oped,
CREATE INDEX failed with "no such column" → whole batch aborted
→ migration never ran → user couldn't open old files. Fix:
defer asset table + indices to a second execute_batch after
migration.

**B-BACKFILL-NOT-PERSISTED:** Opening a legacy file ran backfill
(populating element.assetId from path lookup), but
`prevPresentation` was set to the post-backfill state, so the
diff-based subscriber saw no change, `dirtyElements` was empty,
Cmd+S wrote nothing, next open re-ran backfill. Fix: backfill
returns the touched element IDs; openSqliteProject explicitly
markElementDirty + scheduleFlush.

### Per-element vs per-asset semantic confusion

**B-FORK-WIPES-HISTORY:** When AssetSection.restoreVersion forks
on shared assets, the new forked asset has only one version (the
fresh insert). The inspector now shows the new asset's history,
which is one entry. From the user's POV: "clicking Never wiped
the history." The OLD asset still has full history, but invisible
because the element rebound to the new asset. **This is the bug
that motivates the pinning refactor entirely.**

**B-NEVER-AFFECTS-OTHERS:** Per-asset tri-state's "Never" did
`db_set_asset_auto_reload('off')`, which affected every element
bound to that asset. User expected per-element semantics. Patched
with fork-on-shared logic — same shape as the restore bug above.
Same B-FORK-WIPES-HISTORY ramification: fork created new asset
with fresh history.

**B-RESTORE-AFFECTS-OTHERS:** Same as above for Restore. Patched
with the 3-way RestoreVersionDialog (this slide / all slides /
cancel). "This slide only" = fork; "all slides" = in-place.

### Cascade / mode bugs

**B-COLLISION-REFIRES:** After the user clicked "I understand and
want this auto-updating behavior" on the collision dialog, the
NEXT collision in the same presentation re-prompted. Because the
divergence condition (newBytes vs originalHash) stayed true
forever after the first divergence. Fix: per-presentation,
per-session `acceptedProjects` Set; once accepted, subsequent
collisions silently store.

**B-POWERPOINT-MODE-DIALOG-REFIRES:** After the user picked
"revert + don't want auto-updating" (sets per-pres `autoReloadAssets='off'`), subsequent inserts at same path STILL triggered the
collision dialog → another revert dialog → endless loop of
"opt out" choices. Fix: per-pres OFF short-circuits the entire
collision check (PowerPoint mode = fresh asset every insert,
no dialog).

**B-POWERPOINT-MODE-LOST-RELOAD:** First version of PowerPoint
mode dropped external_path on insertion → no Reload-from-disk
button possible. User wanted manual reload to still work. Fix:
preserve external_path; cascade still blocks watcher
auto-subscription.

**B-FOLLOW-BACK-ON-CONFIRM:** Flipping per-pres auto-reload from
OFF back to ON would have surprised users by resuming auto-update
on every asset. Built ReenableWatchingDialog with "only enable
for new files" vs "re-enable and re-scan all" choices.

### Source-of-truth / multi-flow bugs

**B-COLD-START-NO-PREAMBLE:** Cmd+N seeded `config.mathPreamble`
from global pref, but the in-memory presentation on cold app
launch (Zustand initial state) didn't. Two separate
implementations of "fresh presentation + seeding" were almost
duplicates and drifted. Fix: single helper `createSeededPresentation`
used by both call sites.

**B-UNSAVED-WARNING-INCONSISTENT:** Drag-drop fired the unsaved-
project warning; file picker (+Image button in App.tsx) didn't.
Native pasteboard drag fired it but stored externalPath=null
(misleading — would never be watched even after Save). Fix:
moved the warning into `storeAssetWithCollisionCheck` so every
real-file insertion path covers it uniformly; paste-like paths
with externalPath=null correctly don't fire.

### Macos / system-level (not code bugs but symptoms)

**B-FILE-PICKER-GREYED:** After mutating a file, opening +Image
showed the just-mutated file as greyed out in the picker;
canceling + reopening picker fixed it. Likely NSOpenPanel + UTI
re-classification lag (Spotlight). Not fixed; deferred.

**B-TAURI-CALLBACK-ID-WARNINGS:** macOS atomic-save bursts
generate `[TAURI] Couldn't find callback id ...` warnings in the
Debug Console. Filed as issue #63. Hypothesis: tauri-plugin-fs
re-arms the watcher on inode replacement; events queued before
the re-arm hit the old callback ID. Not fixed.

## Pattern summary

Most bugs cluster around:
1. **Implicit state via absence** — null assetId, absent rows,
   default fallthrough. Bug shapes: missed cases, ambiguous
   "default" interpretation, wipes that propagate too widely.
2. **Multiple sources of truth** that should be one — split seeding
   (B-COLD-START-NO-PREAMBLE), parallel store-asset code paths
   (B-UNSAVED-WARNING-INCONSISTENT), per-asset semantic doing
   per-element duty via fork (B-NEVER-AFFECTS-OTHERS,
   B-RESTORE-AFFECTS-OTHERS, B-FORK-WIPES-HISTORY).
3. **State inheritance across "fresh" operations** — wipes that
   miss tables (B-IMPORT-JSON-MISSED-TABLES), persisted state
   surviving when it shouldn't (B-BACKFILL-NOT-PERSISTED — opposite
   direction; state that should persist didn't).

The pinning refactor directly fixes the per-element/per-asset
confusion (theme 2). The question this brainstorm is for: does
representing pin state as "implicit via NULL" land us back in
theme 1 (implicit state via absence)?
