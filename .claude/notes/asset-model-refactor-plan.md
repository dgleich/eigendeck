# Asset model refactor — plan (v2, simplified)

Captured 2026-05-27. Branch: `svg-pdf-image-cache`. Supersedes the
earlier per-element-pinning plan. Background: walked the design
through two Opus brainstorms (general bug-shape + Beamer-vs-PowerPoint
user worlds), then narrowed against the user's lived workflow.

## The model in one paragraph

**The asset table is the source of truth for the deck.** When file
watching is on, the file system stays in sync with assets (changes
flow in). When it's off, the deck owns the bytes independently.
Elements bind to assets by `asset_id`; they always render the asset's
current bytes (no per-element version pinning). Restoring a historical
version writes a new "current" row in the asset's history; it does
NOT touch the file on disk. This decoupling is the entire reason
assets are stored as bytes in the SQLite file rather than just
referenced by path — it makes the deck portable to collaborators who
may not have the source files.

## Goals

1. **Asset/deck portability.** The `.eigendeck` is self-contained.
   You can hand it to a collaborator with no `figs/` directory; every
   image still renders. Editing text and re-saving is fine.
2. **Beamer-friendly default: files in sync with assets.** Re-running
   `make plots` updates the deck. This is the primary workflow.
3. **PowerPoint-friendly opt-out.** Per-presentation auto-reload off
   = bytes are frozen at insert time; subsequent file changes are
   ignored.
4. **Pre-talk safety net (v1).** History exists so you can revert
   per-asset when auto-update bit you (broken script, bad plot, etc.).
   Project-wide rollback to time T is the natural extension but
   deferred — the data is preserved (manual GC only), so adding the
   UI later is purely additive.
5. **No fork-on-shared mess.** Restore on a shared asset is honest
   about its scope (affects all bound elements); UI tells you that
   before you click.

## What we're NOT doing (cut from earlier plan)

- **Per-element version pinning** (`element.asset_version_id`).
  Solved no real scenario in either user world. Beamer users want
  asset/project rollback (which acts on all bound elements equally);
  PowerPoint users don't share assets across slides (each drop is a
  fresh asset). The per-element pin was over-engineered.
- **"This slide only" vs "all slides" RestoreVersionDialog.** Not
  needed — Restore is always asset-scoped now.
- **Watcher pin-skip logic.** Not needed (no pins).
- **CollisionDialog pin complication.** Not needed.
- **`ReenableWatchingDialog`.** Cascade simplified; no meaningful
  OFF→ON transition to confirm.

## Schema changes

`SCHEMA_VERSION` stays at 3 (nothing shipped). In-place schema
modification + idempotent ALTER for existing local files.

### `elements` table

Add **one** new column (was two in the earlier plan):

```sql
CREATE TABLE elements (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,            -- JSON; assetId/src/demoSrc STRIPPED
  link_id TEXT,                  -- existing promoted column
  asset_id TEXT,                 -- NEW promoted column
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  PRIMARY KEY (id, valid_from)
);
CREATE INDEX idx_el_asset
  ON elements(asset_id)
  WHERE valid_to IS NULL AND asset_id IS NOT NULL;
```

### `assets.auto_reload`

Value domain shrinks from `'on' | 'off' | NULL` to `'off' | NULL`.
No DDL change. Existing `'on'` values are treated as `NULL` by the
new cascade — leave as-is (or normalize once on load if tidy).

### No new tables, no SCHEMA_VERSION bump.

## Cascade (simplified)

```ts
effectiveAutoReload(perAsset, perPresentation, globalDefault) =
  globalDefault
  && perPresentation !== 'off'
  && perAsset !== 'off'
```

- Downward-only. Any layer can refuse; no layer overrides a refusal.
- Per-asset and per-presentation become **2-state** UI toggles.
- Default per-presentation: ON (Beamer-friendly).
- PowerPoint mode: per-pres OFF — toggled by user, persisted on the
  deck.

## Element JSON / column split

Pattern follows existing `link_id`: cross-table references stripped
from JSON, stored as column, reassembled on export.

### Stripped from `elements.data` JSON, promoted to columns:

- `assetId` → `asset_id` column

### Dropped entirely (no column, no JSON, no in-memory field):

- `src` (on ImageElement)
- `demoSrc` (on DemoElement, DemoPieceElement)

The user-facing label for an element's asset is derived from
`asset.path` via the assetId binding.

### Tauri command signatures

```rust
fn db_add_element(
  slide_id, element_id, element_type, data,
  link_id: Option<String>,
  asset_id: Option<String>,        // NEW
  z_order,
)

fn db_update_element(
  id, data,
  link_id: Option<String>,
  asset_id: Option<String>,         // NEW
)
```

JS callers in `flushToSqlite` extract `assetId` from the typed element
object before invoking; JSON `data` gets `assetId`/`src`/`demoSrc`
stripped before storage (same as existing `linkId`/`syncId`).

`db_export_json` reads the column + joins `assets` for `path`, merges
back into per-element JSON during reconstruction.

### TypeScript types

```ts
interface ImageElement extends BaseElement {
  type: 'image';
  // NO src
  assetId: string;            // promoted to required (was optional)
  kind?: 'raster' | 'svg' | 'pdf';
  snapshotVariant?: string;
  shadow?, borderRadius?, opacity?, rotation?;
}
// DemoElement, DemoPieceElement: same — no demoSrc
```

## UI changes

### AssetSection (per-element inspector → asset properties)

```
─── Source file: chart.svg ───
  Used on 3 slides                       ← always visible; "this slide only" when N=1
  [ ] Watch file for changes              ← per-asset 2-state
  Off: file changes don't update any of these 3 slides

  [Reload from disk now]
  [Resize to image]

  Versions:
    Current (3h ago) · 42 KB
    2 days ago · 38 KB             [Restore]
    5 days ago · 41 KB             [Restore]
```

- **"Used on N slides" caption**: always shown. The scope indicator
  for everything below it.
- **"Watch file for changes"**: 2-state. When unchecked, the file
  watcher unsubscribes for this asset (regardless of element-level
  bindings — that's the point).
- **Restore** behavior depends on usage count:
  - N == 1: restore directly, no confirm. No action at a distance
    is possible, so no question to ask.
  - N > 1: single confirm — "Restore `chart.svg` to the version from
    5 days ago? This will affect all 3 slides using this image."
    [Cancel] [Restore].
- **Reload from disk now**: asset-scoped. If watcher is off, manual
  refresh. Affects all bound elements equally.

### PropertiesPanel (Presentation block)

```
[ ] Watch source files in this presentation
   Off: nothing in this presentation auto-updates when files change.
```

2-state checkbox, replacing the prior tri-state.

### SettingsModal

Unchanged — "Auto-reload assets on disk change" checkbox + global
math preamble textarea.

### Removed components

- `ReenableWatchingDialog.tsx` and `reenableWatchingDialog.ts`
- `RestoreVersionDialog.tsx` and `restoreVersionDialog.ts` (replaced
  by an inline confirm in AssetSection, only when N > 1)

### CollisionDialog (already exists)

Unchanged in shape. "I understand" and "Revert + add as new" both
still work; the new element bound to the resulting asset_id has no
pin (no such thing now). Wording may still want a pass.

## Asset GC

NEW Tauri command: `db_gc_assets() -> { removed_versions, removed_assets, removed_cache_rows, bytes_freed }`.

### Reachability rule

A version `(asset_id, valid_from)` is **reachable** iff at least one
current element references the asset. Without per-element pins, only
the current row of any referenced asset is hard-reachable; history
rows of referenced assets are reachable only for rollback purposes
(retention policy, not pin-based).

```sql
WITH referenced_assets AS (
  SELECT DISTINCT e.asset_id
  FROM elements e
  WHERE e.valid_to IS NULL AND e.asset_id IS NOT NULL
)
DELETE FROM assets
WHERE asset_id NOT IN (SELECT asset_id FROM referenced_assets);

DELETE FROM asset_cache
WHERE source_id NOT IN (SELECT asset_id FROM assets);

VACUUM;
```

This removes whole orphan assets (no element references them at all).
For history of referenced assets, see retention policy below.

### Retention policy

Default: **manual GC only**. Never automatic. User triggers from a
menu. Asset history accumulates over time; that's the cost of
supporting rollback.

Optional later: time-window retention (e.g. trim history rows older
than 30 days). Defer; revisit if file size becomes an issue.

### Triggers

- Manual: extend `db_compact` to call `db_gc_assets` too.
- New menu item: File → Compact (Free Unused Assets), shows bytes
  freed in a toast.
- Automatic: deferred.

### Tests

- **Referenced asset survives**: bind one element to asset A; current
  bytes + 3 history rows. Run GC. Assert all of A's rows survive.
- **Orphan asset removed**: asset A exists, no element references it.
  Run GC. Assert all of A's rows (current + history) removed.
- **Cascade to asset_cache**: orphan asset_cache rows for removed
  assets deleted.
- **GC is idempotent**: run twice; second is a no-op.

## Migration for existing local files

In `create_schema`, after the existing v3 migration block:

```rust
// Promote assetId from element JSON to column.
let _ = conn.execute("ALTER TABLE elements ADD COLUMN asset_id TEXT", []);
let _ = conn.execute(
  "UPDATE elements SET asset_id = json_extract(data, '$.assetId')
   WHERE asset_id IS NULL AND json_extract(data, '$.assetId') IS NOT NULL",
  [],
);
let _ = conn.execute(
  "CREATE INDEX IF NOT EXISTS idx_el_asset
   ON elements(asset_id)
   WHERE valid_to IS NULL AND asset_id IS NOT NULL",
  [],
);
```

Dead JSON fields (`assetId`, `src`, `demoSrc`) remain in `data` but
are unused; stripped on next write through `db_update_element`.

`assets.auto_reload = 'on'`: leave as-is (cascade ignores).

## Implementation order + status

Status as of 2026-05-27 (context-reset checkpoint). Branch
`svg-pdf-image-cache`, ~75 commits ahead of `main`, unpushed.

### ✅ Phase 1 — Cascade simplification + 2-state UI — SHIPPED `bd2baa6`

- `effectiveAutoReload` simplified to `global && perPres !== 'off' && perAsset !== 'off'`
- PropertiesPanel per-pres → 2-state checkbox "Watch source files in this presentation"
- AssetSection per-asset → 2-state checkbox "Watch this file for changes"
- "Used on N slides" caption always visible (later refined to "Used N times across M slides")
- Fork-on-shared dropped from `setAutoReload`
- Removed `ReenableWatchingDialog` (component + module + mount)

Follow-ups in this phase:
- `2f2dbdb` — fix watcher hook not re-evaluating when `auto_reload` changes (firing asset-changed event from `setAutoReload`; hook listens + refetches)
- `5f8ad82` — "N copies across M slides" label refinement + Rust-side
  `db_store_asset` preserves `auto_reload` across writes (per-asset, not per-version semantic)
- `1ce0ac9` — fix Inspector infinite-loop bug (Zustand object-returning selector)
- `220b118` — extract `computeAssetUsage` helper + 13 pure-logic tests
- `17a6aee` — AssetSection mount tests (6 tests, including the infinite-loop regression guard)
- `b40907e` — 17 cascade tests + 3 Rust tests for `db_store_asset` auto_reload preservation

### ✅ Phase 2 — RestoreVersionDialog removal — SHIPPED `5c1633c`

Mostly absorbed into phase 1. Just deleted the orphan files +
their mount in App.tsx.

### ✅ Phase 3 — Schema migration + `asset_id` column promotion — SHIPPED `659e476` + `33876d5` + fixes

- `CREATE TABLE elements` gains `asset_id TEXT` column
- Idempotent ALTER TABLE migration + UPDATE backfill from `json_extract(data, '$.assetId')` + index post-migration
- `db_add_element` / `db_update_element` / `db_free_element` / `db_import_json` insertions write the column
- `db_export_json` + `db_export_json_at` read the column, reassemble `assetId` into per-element JSON
- JS `flushToSqlite` extracts `assetId` from element + passes; strips from `data` JSON before serialization
- 5 new Rust tests:
  - `db_add_element_writes_asset_id_column`
  - `db_update_element_writes_asset_id_column`
  - `asset_id_round_trips_through_import_export`
  - `migration_promotes_asset_id_from_legacy_elements_to_column`
  - `db_free_element_preserves_asset_id`

Fixes during phase 3:
- `c72a16d` — missed `cli.rs` callsites (4 sites) + snake_case test names
- `c55e25a` — `CREATE INDEX idx_el_asset` moved out of main schema batch (same pattern as the assets-table index bug from earlier)

### ✅ Phase 4 — Drop `src` / `demoSrc` — SHIPPED (2026-05-27)

Two commits:
- `9929800` Phase 4 prep: Rust migration backfills element.asset_id from data.src path lookup (replaces the JS runtime backfill that was going away)
- `d454fc0` Phase 4 main: drop src/demoSrc from TypeScript types, collapse hook signatures to assetId-only, strip src/demoSrc on save, drop backfillElementAssetIds, update cli.rs to look up paths via asset_id

What shipped:
- `ImageElement`/`DemoElement`/`DemoPieceElement`: `assetId: string` (required), no `src`/`demoSrc`
- Hooks: `useAssetUrl(assetId, hash?)`, `useRenderedAsset(assetId, kind, maxW, maxH, variant?)`, `useAssetFileWatcher(assetId, elementId)`
- `invalidateRenderedAsset(assetId)`, `invalidateAsset(assetId)` — single-arg
- `computeAssetUsage(presentation, assetId)` — no path
- `AssetSection({ assetId, elementId })` — no srcPath
- flushToSqlite strips src/demoSrc alongside linkId/syncId/assetId
- Rust db_import_json strips src/demoSrc from data JSON too
- New helper `refreshDemoFromDisk(assetId)` in SlideElementRenderer for the in-place Refresh button
- New Rust migration step: `UPDATE elements SET asset_id = (SELECT a.asset_id FROM assets a WHERE a.path = ... LIMIT 1)` runs after `assets` table creation
- New Rust test: `migration_backfills_asset_id_from_src_path_lookup`
- cli.rs `cmd_outline` + `cmd_unpack`: enumerate assets via assetId column, look up paths via `db_get_asset_meta_by_id`
- LLM-EDITING.md updated: Image/Demo/DemoPiece examples now use assetId
- docs/ASSETS.md updated: no more "phase 4 will remove" caveats; element binding section reflects the assetId-only world

Tests: 160 JS + 42 Rust (added 1, removed 2 path-fallback-specific assetUsage cases).
Branch state: ~81 commits ahead of main, unpushed.

### ✅ Phase 5 — Asset GC — SHIPPED (2026-05-27)

Commit: `3f61b77`

What shipped:
- `db_gc_assets()` Tauri command — returns `{ removedAssets, removedVersions, removedCacheRows, beforeBytes, afterBytes, bytesFreed }`
- Private `gc_assets_inner(tx)` helper — DELETE pass inside a caller-managed transaction. Reused by `db_compact` so the reachability rule lives in one place.
- `db_compact` extended to call `gc_assets_inner` after its history trim — same transaction, single VACUUM. History trim can close the last reference to an asset, so GC after the trim catches more.
- Cache cascade sweeps legacy pre-phase-4 path-keyed `asset_cache` rows (a path label never equals a UUID asset_id).
- File menu item "Compact (Free Unused Assets)" wired in `src-tauri/src/lib.rs`; JS handler in App.tsx flushes pending writes first then shows a bytes-freed toast.
- `dbGcAssets()` helper in `src/store/db.ts`.

5 new Rust tests:
- `db_gc_assets_preserves_referenced_asset` (current + history both survive)
- `db_gc_assets_removes_orphan` (full removal + cache cascade)
- `db_gc_assets_distinguishes_referenced_from_orphan`
- `db_gc_assets_sweeps_legacy_path_keyed_cache`
- `db_gc_assets_is_idempotent`

Retention: manual-only for v1. No automatic trim of history.
Tests: 47 Rust + 160 JS, all passing.

### ⏳ Phase 6 — `docs/ASSETS.md` rewrite — DONE 2026-05-27 (context-reset)

Done. Reflects:
- Lead with Model B + portability rationale
- Downward-only cascade
- Promoted columns (link_id + asset_id pattern)
- 2-state UI (no tri-state)
- Restore semantics under Model B (single confirm when N>1, no fork)
- "Used N times across M slides" caption
- `auto_reload` preservation semantic
- Watcher hook reactivity (asset-changed event flow)
- Asset GC sketch (deferred)
- Project rollback (deferred)
- Phase 4 src/demoSrc removal noted as "current state, phase 4 will remove"

## Known issues at checkpoint

- **Rust test suite has a pre-existing parallel-execution race** on
  the global `DB: Mutex<Option<Connection>>`. `setup_global_db` /
  `teardown_global_db` mutate the global; tests in parallel
  interleave and yield "No database open" errors. Production
  unaffected (only one DB open at a time, driven by sequential user
  actions). User can workaround with `cargo test -- --test-threads=1`
  or add the `serial_test` crate. Not in scope for the asset
  refactor; flag for follow-up.
- **~~`test_add_slide` asserts `slides[0]["layout"] == "centered"`~~** —
  FIXED 2026-05-27. Same with `test_import_export_roundtrip`. Both
  had stale layout assertions left over from commit 3770280 (the
  v1→v2 schema migration). `layout` is a deprecated field, not
  used by the app; assertions removed.

## Estimate

About a day. Most work is mechanical — the renderer/callsite updates
in phases 3-4. Tricky bits:

- Column round-trip in `db_export_json` (mirrors `link_id`; well-trodden)
- Project rollback transaction (batch restore atomically)
- GC retention policy decision (manual-only for v1 keeps it simple)

## Out of scope (defer)

- **Project-wide rollback to time T.** The Beamer pre-talk safety
  net at project scope. Modal listing file-change events grouped by
  time → batch restore each asset to its version-at-or-before-T.
  Data is preserved by the "manual GC only" retention policy, so
  adding this later is purely additive — no schema or asset-state
  change needed first.
- Automatic GC on save/close
- File-rewrite-on-restore (the "Model A" alternative we rejected)
- Native settings window (#62)
- PDF render (still open)
- PowerPoint drag (open)
- Demo snapshots (#59)
- Split slide/presentation properties (#64)
