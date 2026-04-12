# Eigendeck — SQLite Storage Design

## Overview

Replace the current directory-based storage (presentation.json + images/ + demos/) with a single SQLite file (`.eigendeck`) using a temporal data model. Every change is timestamped, giving unlimited undo history and fast incremental saves.

## Why SQLite

Benchmarked against JSON directory and ZIP (see `tools/bench-storage.mjs`):

| Operation (50MB presentation) | JSON dir | SQLite | ZIP |
|---|---|---|---|
| Incremental save (1 element) | 1.1ms | **0.4ms** | 163ms |
| Full save | 39ms | 144ms | 148ms |
| Read full state | 0.9ms | 1.7ms | 9ms |
| History query | N/A | **3.7ms** | N/A |

SQLite incremental saves are 400x faster than ZIP and give free unlimited history.

## Data Model

### Schema

```sql
-- Presentation-level key/value store
CREATE TABLE presentation (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Slides with temporal versioning
CREATE TABLE slides (
    id TEXT NOT NULL,
    position INTEGER,
    layout TEXT,
    notes TEXT,
    group_id TEXT,
    valid_from TEXT NOT NULL,   -- ISO timestamp + counter
    valid_to TEXT,              -- NULL = current version
    PRIMARY KEY (id, valid_from)
);

-- Elements with temporal versioning
CREATE TABLE elements (
    id TEXT NOT NULL,
    slide_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,         -- Full element JSON
    sync_id TEXT,              -- Content sync group
    link_id TEXT,              -- Animation link group
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
);

-- Binary assets (images, demos) — stored once, deduped by hash
CREATE TABLE assets (
    path TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    mime_type TEXT,
    size INTEGER,
    hash TEXT,
    created_at TEXT
);
```

### Indexes

```sql
-- Current state queries (most common)
CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_el_slide ON elements(slide_id) WHERE valid_to IS NULL;
CREATE INDEX idx_el_id ON elements(id) WHERE valid_to IS NULL;
CREATE INDEX idx_el_sync ON elements(sync_id) WHERE valid_to IS NULL AND sync_id IS NOT NULL;
CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
```

### Pragmas

```sql
PRAGMA journal_mode = WAL;      -- Write-ahead log for concurrent reads
PRAGMA synchronous = NORMAL;    -- Fast writes, safe against app crashes
```

## Operations

### Read current state

```sql
-- All current slides
SELECT * FROM slides WHERE valid_to IS NULL ORDER BY position;

-- Elements for one slide
SELECT * FROM elements WHERE slide_id = ? AND valid_to IS NULL;

-- All elements for all slides (sidebar thumbnails)
SELECT * FROM elements WHERE valid_to IS NULL ORDER BY slide_id;
```

### Write a change

```sql
-- Close the old version
UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL;

-- Insert the new version
INSERT INTO elements (id, slide_id, type, data, sync_id, link_id, valid_from)
VALUES (?, ?, ?, ?, ?, ?, ?);
```

Always wrapped in a transaction. For sync propagation, close+insert for every element with matching sync_id.

### Undo / History

```sql
-- Get all change timestamps (for undo stack)
SELECT DISTINCT valid_from FROM elements ORDER BY valid_from DESC LIMIT 50;

-- Restore state at a specific time
SELECT * FROM elements
WHERE slide_id = ?
  AND valid_from <= ?
  AND (valid_to IS NULL OR valid_to > ?);
```

### Add/Delete slides

Same temporal pattern: close old version, insert new. Deleting a slide closes all its elements too.

## UI Performance (benchmarked)

250 slides, 895 elements, 10 build groups:

| Operation | Time | Notes |
|---|---|---|
| Load slide elements | 0.005ms | Instant |
| Update position (drag) | 0.065ms | 15,000/sec, 0.4% of 60fps budget |
| Sync 20 elements | 0.52ms | 1,900/sec |
| Text edit commit | 0.053ms | Instant |
| Add element | 0.054ms | Instant |
| Delete element | 0.004ms | Instant |
| Get element by ID | 0.002ms | Instant |
| Load all 250 slides | 1.6ms | Fine for sidebar |
| Undo (history query) | 1.8ms | Imperceptible |

No operation blocks the render loop.

## Timestamp Strategy

Timestamps use ISO 8601 + a monotonic counter suffix to avoid collisions in tight loops:

```
2026-04-12T14:53:01.234Z-00000001
```

### When to write

- **Drag/resize**: write on `pointerup` only (not every frame)
- **Text edit**: write on commit (blur / escape)
- **Other changes**: write immediately
- **Auto-save**: no longer needed — every change is persisted instantly

## History Retention (Exponential Thinning)

Keep every version indefinitely isn't practical for large presentations. Use exponential thinning:

| Age | Keep |
|---|---|
| Last 10 minutes | Every version |
| 10 min – 1 hour | One per minute |
| 1 hour – 1 day | One per 10 minutes |
| 1 day – 1 week | One per hour |
| 1 week – 1 month | One per day |
| > 1 month | One per week |

Run thinning on app startup and periodically (e.g. every 30 minutes). Implementation:

```sql
-- Delete intermediate versions older than 10 minutes,
-- keeping one per minute
DELETE FROM elements
WHERE valid_to IS NOT NULL
  AND valid_from < datetime('now', '-10 minutes')
  AND valid_from NOT IN (
    SELECT MIN(valid_from) FROM elements
    WHERE valid_to IS NOT NULL
    GROUP BY strftime('%Y-%m-%d %H:%M', valid_from)
  );
```

## Asset Storage

Binary files (images, demos) stored as BLOBs in the `assets` table:

- **Deduplication**: hash the content, skip if same hash exists
- **No versioning**: assets are immutable (if an image changes, it's a new path)
- **Lazy loading**: only load asset data when actually needed (e.g. when rendering a slide with that image)
- **Large file handling**: SQLite handles BLOBs up to 2GB; for very large files, consider storing outside the DB

## File Format

The `.eigendeck` file is a SQLite database. It can be:

- Opened directly by `better-sqlite3` (Node) or `rusqlite` (Rust/Tauri)
- Inspected with `sqlite3` CLI or any SQLite browser
- Shared as a single file (email, cloud, USB)
- Round-tripped: export to HTML (with embedded source), import back

### Migration from JSON

On first open of a JSON directory:
1. Create a new `.eigendeck` SQLite file
2. Import presentation.json into `presentation` + `slides` + `elements` tables
3. Import images/ and demos/ into `assets` table
4. Keep the original directory as-is (non-destructive)

### Export to JSON directory

For compatibility and LLM editing:
1. Extract current state from SQLite
2. Write presentation.json
3. Extract assets to images/ and demos/

## Architecture

### Where SQLite runs

**Option A: Rust side (Tauri)**
- Use `rusqlite` crate in the Tauri backend
- Frontend sends commands via `invoke()`
- Pro: native speed, direct file access
- Con: all DB operations are async IPC calls

**Option B: JavaScript side (WebView)**
- Use `sql.js` (SQLite compiled to WASM) in the frontend
- Pro: synchronous access, simpler state management
- Con: WASM overhead, file I/O still needs Tauri

**Option C: Hybrid**
- Rust handles file I/O and asset storage
- Frontend uses `sql.js` for the element/slide data (small, frequent)
- Best of both: fast synchronous queries + native file access

**Recommendation**: Start with Option A (Rust). If IPC overhead is noticeable, move hot-path queries to WASM.

## Implementation Plan

1. **Schema + migration**: Create the SQLite schema, write JSON→SQLite importer
2. **Read path**: Replace `setPresentation()` with SQLite queries
3. **Write path**: Replace `updateElement()` / `addElement()` / etc with SQLite writes
4. **Asset storage**: Store images/demos as BLOBs, load on demand
5. **History UI**: Timeline browser, undo from DB instead of zundo
6. **Thinning**: Implement exponential history pruning
7. **CLI support**: Update `tools/eigendeck.mjs` to read/write SQLite
8. **Export**: SQLite → HTML export, SQLite → JSON directory export

## Open Questions

1. Should the Zustand store still hold the full presentation in memory, with SQLite as a persistence layer? Or should we query SQLite on every read?

2. How to handle concurrent access (e.g. collaborative editing via WebSocket + SQLite)?

3. Should demo HTML files be stored as assets (BLOBs) or kept as external files? BLOBs make single-file work; external files allow editing demos in a text editor.

4. Should we keep JSON directory as a parallel format (always export on save) for LLM editing compatibility?

5. WAL mode creates `-wal` and `-shm` sidecar files. These are temporary and cleaned up on close, but could confuse users if they see them. Alternative: use `PRAGMA journal_mode = DELETE` (slower but single file).
