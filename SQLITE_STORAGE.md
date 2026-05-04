# Eigendeck — SQLite Storage Format

## Overview

Every presentation is a single `.eigendeck` file — a SQLite database with WAL journaling and a temporal data model. Every change is timestamped with `valid_from`/`valid_to`, giving unlimited undo history and fast incremental saves.

## File Format

`.eigendeck` = SQLite database. Can be opened by:
- `rusqlite` (Rust, used by the app and `eigendeck-cli`)
- `better-sqlite3` (Node.js, used by `tools/export-eigendeck.mjs`)
- Any SQLite browser or `sqlite3` CLI

## Schema

### `_meta` — Schema versioning

```sql
CREATE TABLE _meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

Currently stores `schema_version = 1`.

### `presentation` — Key/value metadata (NOT temporal)

```sql
CREATE TABLE presentation (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

Keys: `title`, `theme`, `config` (JSON string with width, height, author, venue, mathPreamble, etc.)

### `slides` — Slide metadata (temporal)

```sql
CREATE TABLE slides (
    id TEXT NOT NULL,           -- UUID
    position INTEGER,           -- Array index (0-based display order)
    layout TEXT,                -- 'default', 'centered', 'two-column'
    notes TEXT,                 -- Speaker notes
    group_id TEXT,              -- Slides with same group_id form a build group
    valid_from TEXT NOT NULL,   -- ISO 8601 timestamp + sequence counter
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (id, valid_from)
);
```

### `elements` — Element content and position (temporal)

```sql
CREATE TABLE elements (
    id TEXT NOT NULL,           -- UUID
    type TEXT NOT NULL,         -- 'text', 'image', 'arrow', 'demo', 'demo-piece', 'cover'
    data TEXT NOT NULL,         -- Full JSON: html, position, fontSize, color, preset, etc.
    link_id TEXT,               -- Animation link ID (elements with same link_id animate between slides)
    valid_from TEXT NOT NULL,
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (id, valid_from)
);
```

The `data` column contains ALL element properties as JSON. Position is inside `data.position`. This means a single UPDATE handles any change (text edit, move, resize, style change).

### `slide_elements` — Junction table (temporal)

```sql
CREATE TABLE slide_elements (
    slide_id TEXT NOT NULL,
    element_id TEXT NOT NULL,
    z_order INTEGER NOT NULL,   -- Stacking order (0 = bottom, higher = top)
    valid_from TEXT NOT NULL,
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (slide_id, element_id, valid_from)
);
```

This table maps elements to slides. An element can appear on multiple slides (sync). Z-order is per-slide.

### `assets` — Binary assets (NOT temporal)

```sql
CREATE TABLE assets (
    path TEXT PRIMARY KEY,      -- Relative path, e.g. 'images/photo.png', 'demos/graph.html'
    data BLOB NOT NULL,         -- File content
    mime_type TEXT,              -- e.g. 'image/png', 'text/html'
    size INTEGER,
    hash TEXT,                  -- For dedup (not yet implemented)
    created_at TEXT,
    external_path TEXT,         -- Original absolute disk path (for refresh from file)
    external_mtime TEXT         -- Last known mtime of external file
);
```

### Indexes

```sql
CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_el_id ON elements(id) WHERE valid_to IS NULL;
CREATE INDEX idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
CREATE INDEX idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
```

### Pragmas

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

## Temporal Model

Every row in `slides`, `elements`, and `slide_elements` has:
- `valid_from` — when this version was created
- `valid_to` — when this version was superseded (NULL = current)

**To read current state:** `WHERE valid_to IS NULL`

**To read state at time T:** `WHERE valid_from <= T AND (valid_to IS NULL OR valid_to > T)`

**To update:** close the current row (`SET valid_to = now`), insert a new row with the updated data.

### Timestamps

ISO 8601 UTC + atomic monotonic counter to guarantee uniqueness:

```
2026-04-12T14:53:01.234Z-00000042
```

The counter prevents collisions when multiple changes happen within the same millisecond. Implemented in `chrono_lite_now()` using Howard Hinnant's civil_from_days algorithm (no chrono dependency).

## How Sync Works

**Synced element** = one row in `elements`, multiple rows in `slide_elements`.

```
elements:       { id: "abc", data: {html: "Title", position: ...} }

slide_elements: { slide_id: "slide-1", element_id: "abc", z_order: 0 }
                { slide_id: "slide-2", element_id: "abc", z_order: 0 }
```

Edit text or move → one UPDATE to `elements`. All slides see it instantly.

### In the Zustand store

The frontend uses a different model: each slide has its own copy of the element in the `elements[]` array, with a `syncId` field linking them. The `updateElement` action propagates changes to all elements with the same `syncId`.

On export to JSON (`db_export_json`), if an element appears on multiple slides, the JSON representation gets `syncId` set to the element ID.

On import from JSON (`db_import_json`), elements with the same `syncId` map to one row in `elements` with multiple `slide_elements` rows.

### Freeing a synced element

When you "free" an element from sync:
1. The Zustand store sets `syncId: undefined, _syncId: oldSyncId`
2. The Rust backend creates a new element row (copy of data) and updates the `slide_elements` row for that slide to point to the new copy
3. The old element continues serving other slides

## How Animation Works

**Animation link** = two DIFFERENT elements with the same `link_id`.

```
elements: { id: "abc", link_id: "L1", data: {position: {x:80, y:200}} }   -- slide 1
          { id: "def", link_id: "L1", data: {position: {x:500, y:200}} }  -- slide 2
```

In the presenter, elements with matching `link_id` on consecutive slides animate between positions using CSS transitions.

## Architecture: Zustand + Write-Through

The app does NOT query SQLite on every render. Instead:

```
┌──────────────────┐      ┌──────────────────┐
│   Zustand Store  │ ───> │   SQLite (.eigendeck)
│  (in-memory)     │      │   (on disk / in memory)
│                  │ <─── │
│  Source of truth  │      │  Persistence layer
│  during editing  │      │
└──────────────────┘      └──────────────────┘
```

### On app start
1. `db_open_memory()` creates an in-memory SQLite DB (before first save)
2. Zustand store initializes with a default presentation

### On open project
1. `db_open(path)` opens the file-backed DB
2. `db_export_json()` reads the full presentation
3. Zustand store is populated with the result
4. Write-through subscriber is enabled

### During editing
1. User edits → Zustand store updates
2. Subscriber detects changes by diffing `prevPresentation` vs current
3. Dirty items are tracked:
   - `dirtyElements` — element IDs whose data changed
   - `dirtySlides` — slide IDs whose metadata/position changed
   - `dirtyZOrder` — slide IDs whose element order changed
   - `addedSlides`, `deletedSlides` — structural changes
   - `addedElements`, `deletedElements` — structural changes
4. `scheduleFlush()` debounces (1s) then writes only dirty items to SQLite

### On first save (no project file yet)
1. `db_import_json()` dumps Zustand state into the in-memory DB
2. `db_save_to_file(path)` uses SQLite's backup API to copy memory → file
3. Reopens from file; write-through continues to disk

### On close
1. Flush pending writes
2. `db_close()` checkpoints WAL and closes connection

### Subscriber change detection

| Change | Detection | Flush action |
|--------|-----------|--------------|
| Element data (text, position, style) | `pel !== cel` (reference compare) | `db_update_element` |
| Slide metadata (layout, notes, groupId, theme) | Field compare | `db_update_slide` |
| Slide order (reordering) | Element ID array compare | `db_update_slide` (with position) |
| Element z-order (bring to front, etc.) | Element ID array compare | `db_update_z_order` for each element |
| Element added | New ID not in prev set | `db_add_element` + `slide_elements` INSERT |
| Element deleted | Old ID not in curr set | `slide_elements` UPDATE valid_to |
| Slide added | New ID not in prev set | `db_add_slide` |
| Slide deleted | Old ID not in curr set | `db_delete_slide` |
| Presentation config | Title/config compare | `db_update_presentation` |

### Critical invariant

`sqliteDbPath` is set to `null` during `openSqliteProject()` to prevent the subscriber from treating loaded slides as "new additions" (which would double everything). `prevPresentation` is reset after load.

## Asset Loading

Assets are stored as BLOBs in the `assets` table. The frontend loads them via:

1. `invoke('db_get_asset', { path })` → returns byte array
2. `new Blob([bytes])` → `URL.createObjectURL(blob)` → blob URL
3. Cached in `Map<path, blobUrl>` by `src/lib/demoAssets.ts`

### Images
- Stored with relative path (e.g. `images/pasted-123.png`)
- `ImageBox` component uses `useAssetUrl(path)` hook → blob URL
- Data URLs (`data:image/...`) are used inline (legacy, being migrated)

### Demos
- Stored as HTML in assets table
- `useDemoUrl(path, hash)` hook → blob URL with optional hash fragment
- In export: inlined as srcdoc with bootstrap injection

### Refresh from disk
- Demo overlay has a "Refresh" button when interacting
- Reads HTML from disk relative to the `.eigendeck` file's directory
- Updates the asset in SQLite, invalidates blob cache, reloads iframe

## History & Time Travel

### Viewing history

`db_get_history_timestamps()` collects all timestamps from temporal tables, returns a timeline of events.

### Reconstructing past state

`db_get_state_at(timestamp)` rebuilds the full presentation JSON at any point in time using temporal queries: `valid_from <= ts AND (valid_to IS NULL OR valid_to > ts)`.

### History panel

View > History (Cmd+Shift+H) shows the timeline. Click any entry to preview the state at that time. "Restore" flushes current state first (preserving it in history), then overwrites.

### Compacting

`db_compact(--all)` deletes all history rows and runs VACUUM:

```sql
DELETE FROM slides WHERE valid_to IS NOT NULL;
DELETE FROM elements WHERE valid_to IS NOT NULL;
DELETE FROM slide_elements WHERE valid_to IS NOT NULL;
VACUUM;
```

Exponential thinning (keep more recent history, thin older) is designed but not yet implemented.

## CLI Operations

```bash
eigendeck-cli file.eigendeck info              # Show stats
eigendeck-cli file.eigendeck outline           # Slide outline
eigendeck-cli file.eigendeck list slides       # List all slides
eigendeck-cli file.eigendeck list elements 3   # Elements on slide 3
eigendeck-cli file.eigendeck show slide 3      # Full slide JSON
eigendeck-cli file.eigendeck search "matrix"   # Search content
eigendeck-cli file.eigendeck history           # View edit history
eigendeck-cli file.eigendeck validate          # Check integrity
eigendeck-cli file.eigendeck export json out.json
eigendeck-cli file.eigendeck import json in.json
eigendeck-cli file.eigendeck compact --all     # Delete all history
```

## File Size Considerations

| Component | Typical size | Notes |
|-----------|-------------|-------|
| Slides + elements | 50-200 KB | JSON text, grows with slide count |
| Images (PNG) | 50 KB - 2 MB each | Pasted screenshots are the largest |
| Demo HTML | 20 KB - 500 KB each | D3/interactive demos |
| History | 0 - 50 MB | Grows with edit count, compact to clean |
| SQLite overhead | ~300 KB | Page tables, indexes, WAL |

**Tip**: Run compact before sharing. A 44-slide talk went from 79 MB → 7 MB after compacting and deduplicating images.

**Gotcha**: Image paste used to store base64 data URLs in element JSON (~2 MB per image). Fixed: now stores relative path, loads via blob URL from SQLite. Run the dedup script if you have old presentations with bloated elements.

## WAL Sidecar Files

SQLite WAL mode creates `-wal` and `-shm` files alongside the `.eigendeck` file. These are:
- Normal during operation
- Cleaned up on graceful close (`PRAGMA wal_checkpoint(TRUNCATE)`)
- Harmless if left behind (SQLite recovers on next open)
- Gitignored via `*.eigendeck-wal` and `*.eigendeck-shm`
