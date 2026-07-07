# Eigendeck — SQLite Storage Format

## Overview

Every presentation is a single `.eigendeck` file — a SQLite database with
WAL journaling and a temporal data model. Every change to slides,
elements, slide-element mappings, and assets is timestamped with
`valid_from`/`valid_to`, giving unlimited undo history and fast
incremental saves. Two derived-output caches (`math_cache`,
`asset_cache`) live outside the temporal model.

## File Format

`.eigendeck` = SQLite database. Can be opened by:
- `rusqlite` (Rust — app + `eigendeck-cli`)
- `better-sqlite3` (Node.js — `tools/export-eigendeck.mjs`)
- Any SQLite browser or the `sqlite3` CLI

Schema version is tracked in `_meta` and lives at `3` as of the
asset-model + PDF-rendering work. Migrations are applied
idempotently inside `create_schema()` on every open
(`src-tauri/src/storage.rs:36`) — old files migrate transparently.

## Schema

### `_meta` — Key/value config (NOT temporal)

```sql
CREATE TABLE _meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

Stores:
- `schema_version` — currently `'3'`. Bumped when migrations land.
- `project_id` — stable UUID for the presentation, written on first
  save. Used as the watcher-registry key so registries survive
  rename / move. Lazily generated in memory on first `db_open`;
  persisted to `_meta` on save.

### `presentation` — Key/value metadata (NOT temporal)

```sql
CREATE TABLE presentation (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

Keys: `title`, `theme`, `config` (JSON: width, height, author, venue,
mathPreamble, autoReloadAssets, font selections, etc.)

### `slides` — Slide metadata (temporal)

```sql
CREATE TABLE slides (
    id TEXT NOT NULL,           -- UUID
    position INTEGER,           -- Array index (0-based display order)
    notes TEXT,                 -- Speaker notes
    group_id TEXT,              -- Build groups (consecutive slides
                                -- with same group_id share numbering
                                -- and animate as one logical move)
    config TEXT,                -- Per-slide JSON overrides (theme,
                                -- titleFont, bodyFont, hypeFont).
                                -- NULL = inherit from presentation.
                                -- Keys absent when not overridden.
    valid_from TEXT NOT NULL,
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (id, valid_from)
);
```

The dropped `layout` column was removed in the v1→v2 migration —
layouts are now driven by per-element positions, not a per-slide
mode.

### `elements` — Element content + position (temporal)

```sql
CREATE TABLE elements (
    id TEXT NOT NULL,           -- UUID
    type TEXT NOT NULL,         -- 'text' | 'image' | 'arrow' | 'demo'
                                -- | 'demo-piece' | 'cover'
    data TEXT NOT NULL,         -- JSON: html, position, fontSize,
                                -- color, preset, etc. EXCLUDES
                                -- promoted columns (link_id, asset_id)
    link_id TEXT,               -- Animation link (same id on
                                -- consecutive slides → CSS-transition
                                -- animate between positions)
    asset_id TEXT,              -- For image / demo / demo-piece
                                -- elements: references assets.asset_id.
                                -- Promoted from JSON for index +
                                -- asset-GC reachability queries.
                                -- NULL for non-asset element types.
    valid_from TEXT NOT NULL,
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (id, valid_from)
);
```

`data` holds ALL element properties EXCEPT the promoted columns
(`link_id`, `asset_id`). The promoted fields are stripped from
`data` before INSERT and reassembled into the JSON on
`db_export_json` — see `db_add_element` / `db_update_element` in
`storage.rs`. One UPDATE handles any change (text edit, move,
resize, style change).

### `slide_elements` — Junction table (temporal)

```sql
CREATE TABLE slide_elements (
    slide_id TEXT NOT NULL,
    element_id TEXT NOT NULL,
    z_order INTEGER NOT NULL,   -- Stacking order (0 = bottom)
    valid_from TEXT NOT NULL,
    valid_to TEXT,              -- NULL = current
    PRIMARY KEY (slide_id, element_id, valid_from)
);
```

Maps elements to slides. An element can appear on multiple slides
(sync — see "How Sync Works"). Z-order is per-slide.

### `assets` — Binary asset content (temporal)

```sql
CREATE TABLE assets (
    asset_id TEXT NOT NULL,       -- UUID, stable across versions
    data BLOB NOT NULL,           -- File content (image / SVG / PDF /
                                  -- HTML demo bytes)
    mime_type TEXT,
    size INTEGER,                 -- bytes — used by PDF tier-promotion
                                  -- to decide whether to render at FULL
    hash TEXT,                    -- SHA-256 hex of `data` — dedup +
                                  -- collision dialog
    path TEXT,                    -- DISPLAY LABEL (not unique). Two
                                  -- distinct assets MAY share a path
                                  -- (Import-as-new); resolve by
                                  -- asset_id, never by path.
    external_path TEXT,           -- Source file on disk relative to
                                  -- the .eigendeck dir, for the file
                                  -- watcher to refresh from
    external_mtime TEXT,          -- ISO-8601, last-seen mtime on disk
    auto_reload TEXT,             -- 'on' | 'off' | NULL. Per-asset
                                  -- opt-out; NULL = follow per-pres
                                  -- + global pref cascade
    owner_element_id TEXT,        -- NULL = normal shared asset. Non-null
                                  -- = a PRIVATE per-element sidecar (e.g.
                                  -- a notebook "overlay" of edits +
                                  -- recorded outputs) owned by that
                                  -- element id. Discovered by query,
                                  -- never via elements.asset_id; GC-kept
                                  -- only while the owner element is live;
                                  -- created with an explicit asset_id so
                                  -- it never hits path-based dedup.
    created_at TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,                -- NULL = current version
    PRIMARY KEY (asset_id, valid_from)
);
```

Pre-v3 the table was non-temporal with `path` as PK. The
`create_schema()` migration block (storage.rs:178-238) detects
the old shape, RENAMEs to `assets_legacy`, recreates the temporal
schema, and `INSERT...SELECT`s each legacy row as a single current
version under a fresh `asset_id`.

`auto_reload` is per-ASSET, not per-version: setting it on the
current row applies to all future versions of the same `asset_id`
(see `docs/ASSETS.md` for the cascade resolver detail).
`owner_element_id` is preserved across versions the same way.

**Owner-private assets (`owner_element_id`).** A nullable
`owner_element_id` column distinguishes private per-element sidecars
(notebook overlays) from normal shared assets. Three rules apply
when it is non-null: (1) GC reachability keeps the asset while its
owner element is live (`gc_assets_inner` unions the owner clause
with the `elements.asset_id` clause); (2) it's discovered via
`db_get_owned_asset_id(owner_element_id)`, never through
`elements.asset_id`; (3) it must be created with an explicit
client-minted `asset_id` so it never resolves through the
path-lookup branch (which would collapse two empty overlays onto
one asset). `db_store_asset` gained an `owner_element_id` parameter
that is preserved-when-omitted, mirroring `auto_reload`.

### `math_cache` — MathJax SVG cache (NOT temporal)

```sql
CREATE TABLE math_cache (
    key TEXT PRIMARY KEY,         -- Hash of (tex, bundle, display, preamble)
    tex TEXT NOT NULL,
    bundle TEXT NOT NULL,         -- font bundle id (newcm / shantell / …)
    display INTEGER NOT NULL,     -- 0 = inline, 1 = display
    preamble TEXT NOT NULL,
    svg TEXT NOT NULL,            -- rendered MathJax SVG markup
    width TEXT,
    height TEXT,
    valign TEXT,                  -- vertical-align baseline tweak
    rendered_at INTEGER DEFAULT (strftime('%s','now'))
);
```

Purely a derived-output cache: hits skip the MathJax render. The
CLI export reads from here so headless rendering can produce
per-preset math without spinning up iframes.

### `asset_cache` — Rasterization cache (NOT temporal)

```sql
CREATE TABLE asset_cache (
    source_id TEXT NOT NULL,      -- = assets.asset_id this PNG was
                                  -- derived from
    variant TEXT NOT NULL DEFAULT '_',  -- '_' = single-page; reserved
                                  -- for future PDF page index ('p2')
                                  -- or demo snapshot config name
    width INTEGER NOT NULL,       -- requested max width at render time
    height INTEGER NOT NULL,      -- requested max height at render time
    png BLOB NOT NULL,            -- rasterized output
    source_hash TEXT,             -- optional, for explicit invalidation
    rendered_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (source_id, variant, width, height)
);
CREATE INDEX idx_asset_cache_source ON asset_cache(source_id);
```

Populated by `useRenderedAsset` (PDF rendering, sidebar
thumbnails). Tier-promotion writes two rows per big PDF (FULL +
target). See `docs/ASSETS.md` → "PDF rendering pipeline" for
the full flow. Cleared by `db_clear_asset_cache(source_id)`
per-asset or wholesale by `db_compact(keep_all=true)` (the
"Strip History" Debug action).

### Indexes

```sql
-- Temporal current-row fast paths
CREATE INDEX idx_el_current     ON elements(valid_to)        WHERE valid_to IS NULL;
CREATE INDEX idx_el_id          ON elements(id)              WHERE valid_to IS NULL;
CREATE INDEX idx_slides_current ON slides(valid_to)          WHERE valid_to IS NULL;
CREATE INDEX idx_se_slide       ON slide_elements(slide_id)  WHERE valid_to IS NULL;
CREATE INDEX idx_se_element     ON slide_elements(element_id) WHERE valid_to IS NULL;

-- Promoted columns
CREATE INDEX idx_el_link        ON elements(link_id)         WHERE valid_to IS NULL AND link_id IS NOT NULL;
CREATE INDEX idx_el_asset       ON elements(asset_id)        WHERE valid_to IS NULL AND asset_id IS NOT NULL;

-- Asset lookups
CREATE INDEX idx_assets_current ON assets(asset_id)          WHERE valid_to IS NULL;
CREATE INDEX idx_assets_path    ON assets(path)              WHERE valid_to IS NULL;

-- Cache lookups
CREATE INDEX idx_asset_cache_source ON asset_cache(source_id);
```

### Pragmas

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

## Temporal Model

`slides`, `elements`, `slide_elements`, and `assets` are all temporal:

- `valid_from` — when this version was created
- `valid_to`   — when this version was superseded (NULL = current)

**Read current state:** `WHERE valid_to IS NULL`

**Read state at time T:**
`WHERE valid_from <= T AND (valid_to IS NULL OR valid_to > T)`

**Update:** close the current row (`SET valid_to = now`), then
insert a new row with the updated data — transactional.

### Timestamps

ISO 8601 UTC + atomic monotonic counter to guarantee uniqueness:

```
2026-04-12T14:53:01.234Z-00000042
```

The counter prevents collisions when multiple changes happen within
the same millisecond. Implemented in `chrono_lite_now()` using
Howard Hinnant's civil_from_days algorithm (no chrono dependency).

## How Sync Works

**Synced element** = one row in `elements`, multiple rows in
`slide_elements`.

```
elements:       { id: "abc", data: {html: "Title", position: ...} }

slide_elements: { slide_id: "slide-1", element_id: "abc", z_order: 0 }
                { slide_id: "slide-2", element_id: "abc", z_order: 0 }
```

Edit text or move → one UPDATE to `elements`. All slides see it
instantly.

### In the Zustand store

The frontend uses a different shape: each slide has its own copy
of the element in its `elements[]` array, with a `syncId` field
linking them. The `updateElement` action propagates changes to all
elements with the same `syncId`.

On export to JSON (`db_export_json`), if an element appears on
multiple slides, the JSON gets `syncId` set to the element ID.

On import from JSON (`db_import_json`), elements with the same
`syncId` map to one row in `elements` plus multiple `slide_elements`
rows.

### Freeing a synced element

1. The Zustand store sets `syncId: undefined, _syncId: oldSyncId`
2. The Rust backend creates a new element row (copy of `data`) and
   updates the `slide_elements` row for that slide to point at the new copy
3. The old element continues serving other slides

## How Animation Works

**Animation link** = two DIFFERENT elements with the same `link_id`.

```
elements: { id: "abc", link_id: "L1", data: {position: {x:80,  y:200}} }  -- slide 1
          { id: "def", link_id: "L1", data: {position: {x:500, y:200}} }  -- slide 2
```

In the presenter, elements with matching `link_id` on consecutive
slides animate between positions using CSS transitions.

## Architecture: Zustand + Write-Through

The app does NOT query SQLite on every render. Instead:

```
┌──────────────────┐      ┌──────────────────────┐
│   Zustand Store  │ ───> │   SQLite (.eigendeck)│
│  (in-memory)     │      │   (on disk / memory) │
│                  │ <─── │                      │
│ Source of truth  │      │ Persistence layer    │
│ during editing   │      │                      │
└──────────────────┘      └──────────────────────┘
```

### On app start
1. `db_open_memory()` creates an in-memory SQLite DB
2. Zustand store initializes with a default presentation

### On open project
1. `db_open(path)` opens the file-backed DB
2. `create_schema()` runs all idempotent migrations
3. `db_export_json()` reads the full presentation
4. Zustand store is populated; write-through subscriber enabled

### During editing
1. User edits → Zustand store updates
2. Subscriber diffs `prevPresentation` vs current; tracks dirty:
   - `dirtyElements`, `dirtySlides`, `dirtyZOrder`,
     `addedSlides`/`deletedSlides`,
     `addedElements`/`deletedElements`
3. `scheduleFlush()` debounces (1s) then writes only dirty items

There is **one** import command, `db_import_json`, and one file-write
command, `db_save_to_file`. `db_import_json` resets only the
slide/element graph (`STRUCTURE_TABLES`) and the project id — it
**always preserves the `assets` table and caches**, because assets are
written straight to the DB by `db_store_asset` and are *not* in the
presentation JSON. `db_save_to_file` backs the DB up to a sibling temp
file and **atomically renames it over the target** (clearing the old
file's `-wal`/`-shm` sidecars), so any overwrite is crash-safe and
leaves no stale pages.

### Create / overwrite a deck file (New Project, import-from-HTML, CLI `import`)
1. `db_open_memory()` — build the new deck in a **fresh** in-memory DB
2. `db_import_json(json)` — seed it (structure reset is a no-op on empty
   memory; there are no assets to preserve)
3. `db_save_to_file(path)` — atomic write, replacing any existing file
   wholesale (old file + its assets are gone via the rename)

### First save (untitled) / Save As
1. `db_import_json(json)` on the **live** DB — resets structure, keeps
   this deck's already-stored assets (they aren't in the JSON; issue #65)
2. `db_save_to_file(path)` — atomic write
3. Reopens from file; write-through continues; `project_id` persisted

> **Never open a populated file just to clear it.** Both the dca9005
> stale-asset bug and issue #65 came from the old `db_open(existing) +
> db_import_json(wipe-everything)` pattern. A clean slate now comes from
> building in fresh memory and atomic-saving over the target — the old
> file is replaced wholesale, so no code path ever wipes a live file's
> assets in place.

### On close
1. Flush pending writes
2. `db_close()` runs `PRAGMA wal_checkpoint(TRUNCATE)` and drops the
   connection — flushes WAL into the main file and removes the
   `-wal` / `-shm` sidecars

### Subscriber change detection

| Change | Detection | Flush action |
|--------|-----------|--------------|
| Element data (text, position, style) | `pel !== cel` reference compare | `db_update_element` |
| Slide metadata (notes, groupId, config overrides) | Field compare | `db_update_slide` |
| Slide order (reordering) | ID-array compare | `db_update_slide` (position) |
| Element z-order | ID-array compare | `db_update_z_order` per element |
| Element added | New ID not in prev | `db_add_element` + `slide_elements` insert |
| Element deleted | Old ID not in current | `slide_elements` UPDATE valid_to |
| Slide added | New ID not in prev | `db_add_slide` |
| Slide deleted | Old ID not in current | `db_delete_slide` |
| Presentation config | Title/config compare | `db_update_presentation` |

### Critical invariant

`sqliteDbPath` is set to `null` during `openSqliteProject()` to
prevent the subscriber from treating loaded slides as "new
additions" (which would double everything). `prevPresentation` is
reset after load.

## Asset Loading

Assets are stored as BLOBs in `assets.data`. The frontend resolves
them via one dispatch hook + two backing hooks:

### `useImageSrc(assetId, kind, opts)` — `src/lib/imageSrc.ts`

The single entry point used by every image surface (editor
ImageBox, PresentMode). Picks between the two backing hooks based
on `kind`:

- `'pdf'` → `useRenderedAsset` — pdfium rasterizes the PDF into
  a PNG stored in `asset_cache`. PDFs can't render via
  `<img src=blob:...pdf>` — WebKit doesn't natively rasterize PDF
  inline.
- everything else (`'raster'`, `'svg'`, `undefined`) →
  `useAssetUrl` — raw blob URL, browser-native rendering.

### `useAssetUrl(assetId, hash?)` — `src/lib/demoAssets.ts`

Fetches `assets.data` via `db_get_asset_by_id` (returns
`tauri::ipc::Response` — binary IPC, no JSON-array round trip),
wraps in a blob URL, caches in-memory by `assetId`. Used for
HTML demos + raster + SVG images.

### `useRenderedAsset(assetId, kind, maxW, maxH, variant?)` — `src/lib/assetRenderer.ts`

Cache-or-rasterize PNG into `asset_cache`. Today only PDF takes
this path. Two-tier pipeline (see `docs/ASSETS.md` → "PDF
rendering pipeline"):
- (A) Cheap downscale-from-cache if FULL is already rendered
- (B) Big PDFs (>= 500 KB) render at FULL once, then server-side
  downscale to the requested tier — pdfium parses each PDF
  exactly once across its lifetime

All hooks key off `assetId` exclusively; no path fallback. The
renderer-hook in-memory cache is keyed by `assetId`; the underlying
`asset_cache` SQLite table keys by
`(source_id, variant, width, height)` — multi-row per asset under
tier promotion.

## History & Time Travel

### Viewing history

`db_get_history_timestamps()` collects all timestamps from temporal
tables (slides + elements + slide_elements + assets) and returns
a timeline of events.

### Reconstructing past state

`db_get_state_at(timestamp)` rebuilds the full presentation JSON
at any point in time using temporal queries:
`valid_from <= ts AND (valid_to IS NULL OR valid_to > ts)`.

### History panel

`View > History` (Cmd+Shift+H) shows the timeline. Click any entry
to preview the state at that time. "Restore" flushes current state
first (preserving it in history), then overwrites with the past
state.

### Compacting

`db_compact(keep_all)`:

**`keep_all = true`** ("Strip History" Debug action):

```sql
DELETE FROM elements        WHERE valid_to IS NOT NULL;
DELETE FROM slide_elements  WHERE valid_to IS NOT NULL;
DELETE FROM slides          WHERE valid_to IS NOT NULL;
DELETE FROM asset_cache;          -- wipe all derived renders too
```

Then `db_gc_assets()` removes orphan assets + cascades to any
remaining `asset_cache` rows whose source no longer exists, and
finally `VACUUM` reclaims the freed pages. End state: a fully
clean-slate file with only current rows and no rendered caches.
Used by Debug → Strip History (single file) and Debug → Batch
Strip History (whole directory).

**`keep_all = false`** (default, less aggressive): thin history
older than 1 hour. Leaves `asset_cache` intact — cached renders
remain useful across sessions.

### Asset GC

`db_gc_assets()` independently sweeps assets with no current row
that no current element references. Cascade-deletes
`asset_cache` rows whose `source_id` no longer maps to any
`assets` row. Wired into `db_compact` automatically; can also be
invoked separately for cache-clearing flows.

## CLI Operations

```bash
eigendeck-cli file.eigendeck info              # Show stats
eigendeck-cli file.eigendeck outline           # Slide outline
eigendeck-cli file.eigendeck list slides       # All slides
eigendeck-cli file.eigendeck list elements 3   # Elements on slide 3
eigendeck-cli file.eigendeck show slide 3      # Full slide JSON
eigendeck-cli file.eigendeck search "matrix"   # Search content
eigendeck-cli file.eigendeck history           # View edit history
eigendeck-cli file.eigendeck validate          # Check integrity
eigendeck-cli file.eigendeck export json out.json
eigendeck-cli file.eigendeck import json in.json
eigendeck-cli file.eigendeck compact --all     # Strip all history + caches
```

## File Size Considerations

| Component | Typical size | Notes |
|-----------|-------------|-------|
| Slides + elements | 50–200 KB | JSON text, grows with slide count |
| Images (PNG) | 50 KB – 2 MB each | Pasted screenshots are the largest |
| PDFs | 100 KB – 100 MB each | Vector-heavy academic exports can be large |
| Demo HTML | 20 KB – 500 KB each | D3 / interactive demos |
| History | 0 – 50 MB | Grows with edit count; Strip to clean |
| asset_cache | 0 – several MB | Sidebar thumbs + PDF tier renders; Strip
  History also wipes |
| math_cache | a few KB | Rendered MathJax SVGs |
| SQLite overhead | ~300 KB | Page tables, indexes, WAL |

**Tip**: Run Strip History before committing or sharing. A 44-slide
talk went 79 MB → 7 MB after stripping + deduplicating images. The
"Batch Strip History" Debug action iterates a directory.

**Validation hook**: `tools/check_deck_history.py` lints a deck for
historical-row + asset_cache pollution + unclean WAL/SHM sidecars.
Exits 1 if dirty. Used by the `commit-presentations` skill before
staging.

## WAL Sidecar Files

SQLite WAL mode creates `-wal` and `-shm` files alongside the
`.eigendeck` file. These are:
- Normal during operation
- Cleaned up on graceful close (`PRAGMA wal_checkpoint(TRUNCATE)` runs
  in `db_close()`)
- Harmless if left behind (SQLite recovers on next open)
- Gitignored via `*.eigendeck-wal` and `*.eigendeck-shm`

If you see persistent sidecars next to a recently-modified file,
something opened the DB without closing cleanly — open + quit in
the app to checkpoint.
