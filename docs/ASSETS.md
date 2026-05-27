# Asset handling — design

How Eigendeck stores, watches, renders, and updates binary "asset"
content (images, SVGs, PDFs, demo HTML) embedded in `.eigendeck` files.

This is the single source of truth for the *why* behind the asset
code; schema details that change frequently live in `LLM-EDITING.md`
and the source.

## The model in one paragraph

**The asset table is the source of truth for the deck.** Every asset
embedded in a presentation has its bytes stored in the project's
SQLite file. When file watching is on, the file system stays in sync
with assets — changes to source files on disk flow in via the
watcher. When watching is off, the deck owns the bytes independently.
Elements bind to assets by `asset_id`; they always render the asset's
current bytes (there is no per-element version pinning). Restoring a
historical version writes a new "current" row in the asset's history;
it does NOT touch the file on disk.

## Why this model

**Portability.** A `.eigendeck` is self-contained. Hand it to a
collaborator who doesn't have your `figs/` directory and every image
still renders. They can edit text, present, save, send back. Their
local file watcher has nothing to subscribe to (their disk has no
source files), but nothing breaks. The Beamer-style auto-update
workflow is just a convenience layer on top — bytes-on-disk is not a
hard dependency.

The two user mental models we accommodate:
- **Beamer-style (primary)**: scripts (Python, R, gnuplot)
  regenerate plots; the deck auto-updates on the next file change.
  History exists for the pre-talk-panic case (broken script → revert
  per-asset).
- **PowerPoint-style (secondary)**: bytes are frozen at insert time;
  subsequent file changes are ignored. Per-presentation auto-reload
  off; new file inserts → new assets.

## Data model

### `assets` table — temporal

```sql
CREATE TABLE assets (
  asset_id        TEXT NOT NULL,       -- UUID, stable across versions
  data            BLOB NOT NULL,       -- raw bytes
  mime_type       TEXT,
  size            INTEGER,
  hash            TEXT,                -- SHA-256 hex of data
  path            TEXT,                -- DISPLAY LABEL, NOT UNIQUE
  external_path   TEXT,                -- source file path relative to .eigendeck dir
  external_mtime  TEXT,                -- ISO-8601, last seen on disk
  auto_reload     TEXT,                -- 'off' | NULL (per-asset opt-out)
  created_at      TEXT NOT NULL,
  valid_from      TEXT NOT NULL,
  valid_to        TEXT,                -- NULL = current row for this asset_id
  PRIMARY KEY (asset_id, valid_from)
);
```

Every byte change creates a new row with a fresh `valid_from`; the
prior row's `valid_to` is set to the same instant. "Current" rows
have `valid_to IS NULL`. Version history is "every row with this
asset_id, newest first."

#### Path is NOT unique

`path` is a display LABEL — it's what shows up in the inspector,
the version history, and CLI listings. Two distinct assets can
legitimately share a path label (e.g. two `screenshot.png` imports
from different folders). Element-to-asset binding is therefore by
`asset_id`, never by path.

#### `asset_id` is a UUID

Stable across renames, copies, edits, and Save-As (which forks the
asset history along with the project_id). Independent of file path
on disk. Generated on first insert; never reused.

#### `auto_reload` value domain

Narrowed from `'on' | 'off' | NULL` to `'off' | NULL`. Per-asset
opt-out: an asset can refuse to be watched but can't opt in beyond
what the presentation/global allows. Legacy `'on'` values from the
earlier tri-state UI are tolerated and treated as if NULL.

#### `auto_reload` is per-ASSET, not per-version

`db_store_asset` preserves the existing asset's `auto_reload` value
when the caller passes `None`. Only an explicit `Some(value)`
override (e.g. `db_restore_asset_version` hardcoding `'off'`)
replaces it. Without this, every file-watcher write or Reload-from-
disk would silently reset the user's per-asset opt-out.

### `elements` table — promoted columns

```sql
CREATE TABLE elements (
  id           TEXT NOT NULL,
  type         TEXT NOT NULL,
  data         TEXT NOT NULL,    -- JSON; promoted fields stripped
  link_id      TEXT,             -- promoted (cross-slide animation peer)
  asset_id     TEXT,             -- promoted (binding to assets row)
  valid_from   TEXT NOT NULL,
  valid_to     TEXT,
  PRIMARY KEY (id, valid_from)
);
CREATE INDEX idx_el_asset
  ON elements(asset_id)
  WHERE valid_to IS NULL AND asset_id IS NOT NULL;
```

#### Promoted columns

The pattern: anything that's a cross-table reference or needs SQL-
level indexing is **stripped from the JSON `data` blob and stored as
its own column**. `db_export_json` reassembles the JSON on the way
out by merging the columns back into per-element objects.

This is the existing pattern for `link_id` (cross-slide animation
peers); `asset_id` follows the same pattern.

The `data` JSON holds only type-specific fields (e.g. `position`,
`shadow`, `kind` for an image element; `html`, `fontSize`, `color`
for a text element). Bindings (`linkId`, `assetId`) live in promoted
columns. Old `src` / `demoSrc` fields are stripped on the next write
through `db_update_element` for forward-migrated files.

## Cascade resolver (downward-only)

```ts
effectiveAutoReload(perAsset, perPresentation, globalDefault) =
  globalDefault
  && perPresentation !== 'off'
  && perAsset !== 'off'
```

Any layer can refuse. No layer overrides a refusal above it.

| Layer | Where | UI surface |
|---|---|---|
| Global | `localStorage['eigendeck:pref:autoReloadAssets']` boolean | Cmd+, Settings checkbox |
| Per-presentation | `config.autoReloadAssets` (`'off'` or absent) | Inspector → Presentation block → 2-state checkbox |
| Per-asset | `assets.auto_reload` (`'off'` or NULL) | Inspector → Asset section → 2-state checkbox |

Each non-global layer is a 2-state opt-out (`'off'` or absent). The
old tri-state ("Always / Never / Follow global") is gone; per-asset
or per-pres `'on'` values from old DBs are treated as if absent.

## Element binding

Image / demo / demo-piece elements carry one field:

- `assetId: UUID` (required; stored in the `elements.asset_id`
  column) — the canonical binding to a row in `assets`.

Path label, source link, and watch settings all live on the asset.
The renderer resolves bytes via `db_get_asset_by_id`; the inspector
shows the display path by looking up `asset.path` via the same id.

### Schema migration to `asset_id` column

`create_schema` is idempotent. For files older than the column:

1. `ALTER TABLE elements ADD COLUMN asset_id TEXT` (no-op if present).
2. `UPDATE elements SET asset_id = json_extract(data, '$.assetId')`
   for any element whose JSON had an explicit `assetId`.
3. `UPDATE elements SET asset_id = (SELECT asset_id FROM assets WHERE
   path = data.src OR path = data.demoSrc LIMIT 1)` for legacy
   elements that only had `src` / `demoSrc` in the JSON. Runs after
   the `assets` table is created.
4. `CREATE INDEX idx_el_asset`.

Same pattern as v1→v2 (`slides.config` column add). Old JSON fields
(`src`, `demoSrc`, `assetId`) get stripped on the next write through
`db_update_element`.

## Asset lifecycle

### Insertion

Six paths, all converging on `db_store_asset`:

| Source | `externalPath` | Watcher? |
|---|---|---|
| Drag-drop file from Finder | rel path from .eigendeck dir | yes |
| File picker (+Image / +Demo) | rel path | yes |
| Clipboard paste (web `DataTransfer` or `navigator.clipboard`) | `null` | no |
| Native macOS NSPasteboard (Office SVG, PDF, etc.) | `null` | no |
| Tauri file-drop event | rel path | yes |
| Collision-dialog choices (rare) | varies | varies |

`db_store_asset(path, data, mime, externalPath, externalMtime,
assetId?, autoReload?) -> assetId`:

1. Determine `asset_id`: explicit (passed in) > path-lookup of most-
   recent existing > fresh UUID.
2. SHA-256 hash dedup: if the current row for this `asset_id` has
   the same hash as the new bytes, no-op return same id.
3. **Preserve auto_reload**: if caller passed `None` AND the asset
   already has a current row, inherit that row's `auto_reload`. Only
   explicit `Some(value)` overrides.
4. Transactional close-old + insert-new with the resolved
   `asset_id`.

**Footgun**: the path-lookup-most-recent branch (step 1 fallback)
silently reuses an existing asset_id when the path matches. Callers
that need a guaranteed-fresh asset_id at an existing path must
generate a UUID themselves (`crypto.randomUUID`) and pass it
explicitly. See `src/lib/assetInsert.ts` for the canonical example.

### Path-collision dialog (`storeAssetWithCollisionCheck`)

Drag-drop and file-picker insertions route through
`storeAssetWithCollisionCheck`. Triggered when:

- The new insertion's path already exists in the project as a
  current asset, AND
- The new bytes' hash differs from the existing asset's *original*
  hash (oldest version in history)
- AND per-presentation `autoReloadAssets !== 'off'` (PowerPoint mode
  skips the dialog entirely — every insert is independent)
- AND this presentation hasn't been "session-accepted" for auto-
  updating already (see Workflow rule below)
- AND the asset has elements currently using it (orphan assets skip
  the dialog)

Dialog choices (no default focus — user explicitly opts in):

| Choice | Effect |
|---|---|
| **I understand and want this auto-updating behavior** | Reuse existing asset_id. Bytes update on the asset; every bound element shows the new bytes. Session-flag set: no more dialogs for this presentation until app restart. |
| **I want to revert ... I don't want the auto-updating behavior** | (1) Restore existing asset to its oldest version (file watcher disabled per-asset). (2) Create a NEW asset at the same path with the just-dragged bytes; new element binds to it. (3) Set per-pres `autoReloadAssets='off'` (PowerPoint mode). |
| Esc / outside-click | Cancel insertion entirely. |

#### Workflow rule (the per-choice contract)

- **"I understand"** is a per-app-session commitment for this
  presentation: "I'm informed about auto-updating, don't keep asking
  me." Subsequent collisions silently update on the existing asset
  for the rest of the app session. The flag clears on app restart.
- **"I don't want this"** is a structural commitment for the
  presentation: per-pres `autoReloadAssets='off'` (persisted in the
  `.eigendeck`). Permanent PowerPoint mode.
- **Esc** is "I'm not deciding now." Nothing remembered; re-
  attempting the same insert re-prompts.

### PowerPoint mode (per-pres auto-reload OFF)

When `config.autoReloadAssets === 'off'`:

- Every insertion creates an INDEPENDENT asset. Fresh `asset_id`
  (client-generated UUID), never reuses an existing asset_id even if
  the path label matches.
- `external_path` IS preserved. The Reload-from-disk-now button
  works. The cascade blocks the watcher from auto-subscribing.
- No collision dialog ever.

Flipping per-pres back to ON re-enables the watcher cascade for
existing assets with `external_path` and no per-asset `'off'`.
Assets the user explicitly opted out of stay opted out.

### Update (in-place new version)

Triggered by:
- File watcher firing on a disk change
- Manual "Reload from disk now" in the Asset properties section
- Open-time scan (`scanForChangedAssets`) catching disk edits made
  while the project was closed
- SVG embed-snapshot follow-up
- Collision-dialog "I understand" choice

All call `db_store_asset` with the existing `asset_id`. Transactional
close-old + insert-new with a new `valid_from`. Old bytes stay in
history; "current" pointer moves. `auto_reload` is preserved across
the write (see "preservation" semantic above).

### Restore

`db_restore_asset_version(asset_id, valid_from)` snapshots an old
version's bytes + metadata and inserts them as the new current.
Sets `auto_reload='off'` on the restored row so the watcher doesn't
immediately overwrite.

Per-element semantics under Model B: Restore is asset-scoped.
Affects every element bound to the asset_id. The UI tells the user
the blast radius via the "Used N times across M slides" caption and
a single confirm dialog when more than one element is bound:

- Solo asset (1 element): restore directly, no confirm.
- Shared asset (N > 1 elements): single confirm — *"Restore
  chart.svg to the version from 3 hours ago? This will affect all 3
  copies of this image across 2 slides."* [Cancel] [Restore]

No "this slide only" mechanism; that was the old fork-based design,
which lost history visibility. Per-element divergence is achieved
the PowerPoint-style way: duplicate the asset (a future "Save as
new asset" affordance) or set per-pres to OFF.

### History display

The Asset properties section shows every version newest-first via
`db_get_asset_history(asset_id)`. Each row has size, friendly
relative timestamp (e.g. "3 hours ago"), full timestamp on hover,
"current" badge, and a "Restore" button for non-current versions.
Hovering a row pops a floating thumbnail to the left, lazy-fetched
via `db_get_asset_version(asset_id, valid_from)`.

## Cache invalidation event

`invalidateRenderedAsset(sourceId, assetId?)`:

1. `db_clear_asset_cache(sourceId)` — drop SQLite-cached rasterized
   PNGs (`asset_cache` table).
2. `invalidateAsset(path, assetId?)` — drop in-memory blob URL cache
   in `demoAssets.ts` (both id-keyed and path-keyed entries).
3. Dispatches `eigendeck:asset-changed` window event with
   `{path, assetId}` detail.

Subscribers:
- `useAssetUrl`, `useRenderedAsset` (rendering hooks) — refetch on
  match.
- `AssetSection` — refetch meta + history.
- **`useAssetFileWatcher`** — refetches meta and re-evaluates the
  cascade. Critical for "unchecking Watch unsubscribes" and
  "Restore disables the watcher" — without this re-evaluation the
  hook's existing subscription persisted across `auto_reload` flips.

Match logic: prefer `assetId` match when both sides have one, else
fall back to `path` match.

## File watching

### `WatcherRegistry`

`src/lib/watcherRegistry.ts` — singleton per `project_id` (UUID in
`_meta`). Maintains `Map<external_path, WatchEntry>` where
`WatchEntry.assets: Map<asset_id, {subscribers: Set<element_id>, ...}>`.

Two layers of ref-counting:
- **Per-element subscribers** (`Set<element_id>` inside each asset
  entry). Multiple elements can share an asset; the asset entry
  stays alive as long as ANY element references it.
- **Per-asset entries** (Map keyed by asset_id under each watch).
  Multiple assets can share a path (Import-as-new); the path watch
  stays alive as long as ANY asset entry references it.

Without per-element tracking, one element's unmount would wipe the
asset entry that was also serving other elements — silently killing
the watcher for everyone.

### Coalescing

macOS atomic saves emit 3–7 events for one save (write + truncate +
close + rename). The registry coalesces at 250ms per path; only the
first event in the burst triggers `handleChange`. Subsequent events
within the window are skipped.

### Cross-cutting Tauri requirements

The watcher needs BOTH `tauri-plugin-fs`'s `watch` Cargo feature
AND `fs:allow-watch` / `fs:allow-unwatch` capabilities in
`src-tauri/capabilities/default.json`. Missing either yields
`Command watch not found` (Cargo feature) or a permission rejection
(capability).

### Scan-on-load

`scanForChangedAssets(projectDir, presOverride)` stats every linked
asset on project open and reloads any whose `external_mtime`
differs. Catches edits made while the project was closed. Gated by
the same cascade.

### Unsaved presentations

File watching is impossible without a project directory to resolve
`external_path` against. When the user adds a trackable asset to an
unsaved presentation:

- A toast warns: *"Asset added, but file-watching is disabled until
  the presentation is saved."* with a Save… button.
- The Properties → Asset section replaces the Watch toggle + Reload
  button with a yellow info bar + Save… button.
- Toast suppressed when effective auto-reload is OFF (user opted
  out; no nag).

## Renderer

Two hooks resolve assets to blob URLs:

- `useAssetUrl(assetId, hash?)` (`src/lib/demoAssets.ts`) — raw
  bytes via blob URL, cached. Used for HTML demos and unrasterized
  images.
- `useRenderedAsset(assetId, kind, maxW, maxH, variant?)`
  (`src/lib/assetRenderer.ts`) — cache-or-rasterize PNG into the
  `asset_cache` SQLite table. Used by slide-sidebar thumbnails. SVG
  ≤ 200 KB takes the native fast path (raw blob URL); larger SVG
  and all raster go through the PNG cache.

Both key off `assetId` exclusively (`db_get_asset_by_id`); no path
fallback. Cache key is the `assetId`.

## UI

### AssetSection (Properties → Asset, when an image element is selected)

```
─── Source file: chart.svg ───
  Used 3 times across 2 slides         ← always visible scope caption
  [ ] Watch this file for changes      ← 2-state per-asset opt-out
       On: file changes update all 3 copies of this image.

  [Reload from disk now]   [Resize to image]

  Versions:
    Current (3h ago) · 42 KB
    2 days ago · 38 KB        [Restore]
    5 days ago · 41 KB        [Restore]
```

#### "Used N times across M slides" caption

Always visible. Phrasing variants:

- 1 copy / 1 slide → "Used on this slide only"
- N copies / 1 slide → "Used N times on this slide"
- 1 copy each / M slides → "Used on M slides"
- N copies / M slides (mixed) → "Used N times across M slides"

Computed by the pure `computeAssetUsage` helper in
`src/lib/assetUsage.ts` (also used by collision dialog for the
slide-numbers list). Tests in `src/lib/assetUsage.test.ts`.

#### Watch checkbox states

Checkbox is checked when the asset's effective auto-reload resolves
to ON. Disabled when blocked higher in the cascade (global off, or
per-pres off). Consequence text below explains the resolution.

### PropertiesPanel (Presentation block)

```
[ ] Watch source files in this presentation
   On: linked SVG / image assets reload when their source files change on disk.
```

Single 2-state checkbox under the existing Presentation header.

### SettingsModal (Cmd+,)

Global "Auto-reload assets on disk change" checkbox + global LaTeX
preamble textarea. Webview-based; native-window version deferred to
issue #62.

## Settings surfaces summary

| Setting | Storage | UI |
|---|---|---|
| Global `autoReloadAssets` | `localStorage` | Cmd+, Settings → checkbox |
| Global `mathPreamble` | `localStorage` | Same Settings modal → textarea |
| Per-presentation `autoReloadAssets` | `config.autoReloadAssets` in `.eigendeck` JSON | Inspector → Presentation → checkbox |
| Per-presentation `mathPreamble` | `config.mathPreamble` | Inspector → Presentation → textarea + Insert/Replace global buttons |
| Per-asset `auto_reload` | `assets.auto_reload` column | Inspector → Asset → checkbox (only when project saved) |

### Math preamble semantics

**Render time**: only `config.mathPreamble` (per-presentation)
matters. No cascade or merge with global.

**Editing time**: global is a template:
- New presentations seed `config.mathPreamble` from global at
  creation (`createSeededPresentation` in `store/presentation.ts`).
- "Insert global" button on the per-presentation textarea prepends.
- "Replace with global" overwrites (confirm if non-empty).
- Both buttons disabled when global is empty.

## Toasts (non-modal user warnings)

`src/lib/toasts.ts` + `<ToastHost>` at bottom-center. Used for
"asset added to unsaved presentation" warning. Color-coded by kind
(info / warning / error / success), auto-dismiss with `ttl` (0 =
sticky), `key` field dedupes repeats.

## Asset GC (planned; not yet built)

Reachability rule: a version `(asset_id, valid_from)` is reachable
iff at least one current element references the asset_id.
Unreferenced assets — including their current row AND all their
history — are GC-able.

```sql
-- Sketch of the future db_gc_assets query
WITH referenced_assets AS (
  SELECT DISTINCT asset_id
  FROM elements
  WHERE valid_to IS NULL AND asset_id IS NOT NULL
)
DELETE FROM assets
WHERE asset_id NOT IN (SELECT asset_id FROM referenced_assets);

DELETE FROM asset_cache
WHERE source_id NOT IN (SELECT asset_id FROM assets);

VACUUM;
```

Retention policy: **manual GC only** in v1. History accumulates
over time; that's the cost of supporting per-asset Restore (and
the future project-wide rollback).

Trigger: future File menu → "Compact (Free Unused Assets)" or
extension of `db_compact`.

## Project rollback (deferred; data preserved)

Project-wide "Roll back to time T" is the Beamer pre-talk-panic
feature: pick a timestamp, batch-restore every asset to its version
at-or-before-T. Deferred from the asset-model refactor — the data
is preserved by the "manual GC only" retention policy, so adding
the UI is purely additive whenever it's prioritized.

## Insertion path detail (paste / drag / pasteboard)

### Paste (Cmd+V)

Priority order: SVG > PDF > raster. Vendor UTIs aliased to canonical
MIMEs (`com.microsoft.image-svg-xml` → `image/svg+xml`,
`com.adobe.pdf` → `application/pdf`).

Three discovery paths:
1. Native macOS `NSPasteboard` via `objc2-app-kit`
   (`pasteboard_list_types` / `pasteboard_read_type` Tauri
   commands) — the only path that sees Office/Apple/Adobe custom
   UTIs that WebKit filters out.
2. Async `navigator.clipboard.read()` — sometimes exposes formats
   the sync API doesn't.
3. Sync `clipboardData.items` — fallback.

### Drag-drop

Two paths:
1. Native macOS drag pasteboard via `pasteboard_read_drag_type` —
   exposed during Tauri's `onDragDropEvent` handler. Sees the same
   Office/Adobe UTIs paste does.
2. Web `DataTransfer.items` — fallback for non-Mac and safety net.

**Unsolved**: drag-out-of-PowerPoint produces zero JS events
because Tauri's drag-drop bridge filters at the NSWindow level
before any custom-UTI drag reaches the webview. Documented as a
known limitation; tracked separately. Paste works as a workaround.

### File picker

`@tauri-apps/plugin-dialog` `open()`, then file read + store. Same
`db_store_asset` call.

## Files

| File | Role |
|---|---|
| `src-tauri/src/storage.rs` | `assets` table, element columns, all `db_*` asset commands |
| `src-tauri/src/pasteboard.rs` | Native NSPasteboard reads |
| `src/lib/watcherRegistry.ts` | Per-`project_id` watcher singleton, scan-on-load |
| `src/lib/assetWatcher.ts` | `useAssetFileWatcher` React hook |
| `src/lib/assetUsage.ts` | Pure helper: `computeAssetUsage(presentation, assetId)` |
| `src/lib/assetInsert.ts` | `storeAssetWithCollisionCheck` + the collision-dialog flow |
| `src/lib/demoAssets.ts` | `useAssetUrl` / `getAssetUrl` + blob cache |
| `src/lib/assetRenderer.ts` | `useRenderedAsset` / `renderAsset` + cache invalidation |
| `src/lib/preferences.ts` | `usePreference`, `effectiveAutoReload` (cascade resolver) |
| `src/lib/toasts.ts` | Module-level toast subscribe pattern |
| `src/lib/collisionDialog.ts` + `src/components/CollisionDialog.tsx` | Collision-dialog plumbing |
| `src/components/AssetSection.tsx` | Properties panel section per image element |
| `src/components/AssetSection.test.tsx` | Mount tests — regression guard for the infinite-loop bug |
| `src/components/SettingsModal.tsx` | Global preferences modal |
| `src/components/ToastHost.tsx` | Toast renderer mounted in App |
| `src/components/SlideEditor.tsx` | All insertion callsites (paste, drag, native pasteboard) |
| `src/store/presentation.ts` | `flushToSqlite` write-through |
| `src/types/presentation.ts` | `ImageElement.assetId` (required), no path field |

## Open questions / deferred

- **Native settings window** (#62) — current SettingsModal is
  webview; native NSPanel scales better with future preferences.
- **PDF render path** — `pdfium-render` integration; bytes stored
  today, render is placeholder.
- **PowerPoint drag** — needs a Tauri plugin or NSView subclass to
  bypass the webview's drag MIME filter.
- **Demo snapshots** (#59) — `asset_cache.variant` column reserved;
  capture flow not built.
- **Cross-platform clipboard** — swap `pasteboard.rs` for
  `clipboard-rs` when Win/Linux become real targets.
- **Watcher orphan-callback warnings on macOS atomic-save** (#63) —
  cosmetic; functionally harmless.
- **Asset GC** — sketched above, not built. Deferred from the asset
  refactor.
- **Project rollback to time T** — deferred; data preserved so it's
  additive.
