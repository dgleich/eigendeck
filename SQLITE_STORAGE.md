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

Three tables + assets. Elements own their position. Sync is just one element appearing on multiple slides via the junction table.

### Schema

```sql
-- Presentation-level key/value store
CREATE TABLE presentation (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Slides (temporal)
CREATE TABLE slides (
    id TEXT NOT NULL,
    position INTEGER,
    layout TEXT,
    notes TEXT,
    group_id TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
);

-- Elements own their content AND position (temporal)
CREATE TABLE elements (
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,         -- Full JSON: html, position, fontSize, color, etc.
    link_id TEXT,               -- Animation link (different elements that animate between slides)
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
);

-- Junction: which elements appear on which slides
-- Sync = one element, multiple rows here
CREATE TABLE slide_elements (
    slide_id TEXT NOT NULL,
    element_id TEXT NOT NULL,
    z_order INTEGER NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (slide_id, element_id, valid_from)
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

## How Sync Works

**Synced element** = one row in `elements`, multiple rows in `slide_elements`.

```
elements:       { id: "abc", type: "text", data: {html: "Title", position: {x:80, y:20, ...}} }

slide_elements: { slide_id: "slide-1", element_id: "abc", z_order: 0 }
                { slide_id: "slide-2", element_id: "abc", z_order: 0 }
                { slide_id: "slide-3", element_id: "abc", z_order: 0 }
```

- Edit text on any slide → one UPDATE to `elements`. All three slides see it instantly.
- Move element → one UPDATE to `elements` (position is in data). All three slides move.
- No propagation code. No syncId matching. Just relational data.

## How Animation Works

**Animation link** = two DIFFERENT elements with the same `link_id`.

```
elements:       { id: "abc", link_id: "L1", data: {position: {x:80, y:200}} }   -- slide 1
                { id: "def", link_id: "L1", data: {position: {x:500, y:200}} }  -- slide 2
```

In the presenter, elements with matching `link_id` on consecutive slides animate between their positions. They're separate elements with separate content and positions.

## Freeing a Synced Element

When you want an element to have independent content on one slide:

1. Duplicate the element: INSERT new row in `elements` with new ID, copy of data
2. Update the `slide_elements` row for that slide to point to the new copy
3. Optionally set matching `link_id` on both for animation

Before: one element on 3 slides.
After: original on 2 slides, copy on 1 slide. They're independent.

## Operations

### Load a slide

```sql
SELECT e.id, e.type, e.data, e.link_id, se.z_order
FROM slide_elements se
JOIN elements e ON e.id = se.element_id AND e.valid_to IS NULL
WHERE se.slide_id = ? AND se.valid_to IS NULL
ORDER BY se.z_order;
```

### Edit an element (text, position, any property)

```sql
-- Close old version
UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL;
-- Insert new version
INSERT INTO elements (id, type, data, link_id, valid_from)
VALUES (?, ?, ?, ?, ?);
```

One write. Every slide that references this element sees the change.

### Add element to a slide

```sql
INSERT INTO elements (id, type, data, link_id, valid_from)
VALUES (?, ?, ?, ?, ?);
INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from)
VALUES (?, ?, ?, ?);
```

### Delete element from one slide

```sql
UPDATE slide_elements SET valid_to = ?
WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL;
```

Element still exists on other slides.

### Delete element from all slides

```sql
UPDATE slide_elements SET valid_to = ?
WHERE element_id = ? AND valid_to IS NULL;
```

### Duplicate a slide (build step)

```sql
-- New slide
INSERT INTO slides (id, position, ...) VALUES (...);
-- Copy all element references (same elements, new z_order rows)
INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from)
SELECT ?, element_id, z_order, ?
FROM slide_elements
WHERE slide_id = ? AND valid_to IS NULL;
```

All elements are now synced between original and copy. To free one, duplicate the element.

### Find which slides an element appears on

```sql
SELECT slide_id FROM slide_elements
WHERE element_id = ? AND valid_to IS NULL;
```

### Undo: restore state at timestamp

```sql
-- Elements as of time T
SELECT e.id, e.type, e.data, e.link_id
FROM elements e
WHERE e.valid_from <= ? AND (e.valid_to IS NULL OR e.valid_to > ?);

-- Slide-element mappings as of time T
SELECT se.slide_id, se.element_id, se.z_order
FROM slide_elements se
WHERE se.valid_from <= ? AND (se.valid_to IS NULL OR se.valid_to > ?);
```

## Timestamp Strategy

ISO 8601 + monotonic counter to avoid collisions:

```
2026-04-12T14:53:01.234Z-00000001
```

### When to write

- **Drag/resize**: write on `pointerup` only (not every frame)
- **Text edit**: write on commit (blur / escape)
- **Other changes**: write immediately
- **Auto-save**: not needed — every change is persisted instantly

## History Retention (Exponential Thinning)

| Age | Keep |
|---|---|
| Last 10 minutes | Every version |
| 10 min – 1 hour | One per minute |
| 1 hour – 1 day | One per 10 minutes |
| 1 day – 1 week | One per hour |
| 1 week – 1 month | One per day |
| > 1 month | One per week |

Run thinning on app startup and periodically.

## Asset Storage

Binary files stored as BLOBs in `assets`:

- **Dedup**: hash content, skip if exists
- **No versioning**: assets are immutable
- **Lazy load**: only read BLOB when rendering
- **Path-based**: referenced by relative path in element data (e.g. `images/photo.png`)

## File Format

`.eigendeck` = SQLite database. Can be:

- Opened by `better-sqlite3` (Node), `rusqlite` (Rust), `sqlite3` CLI
- Shared as a single file
- Inspected with any SQLite browser

### Migration from JSON

1. Create `.eigendeck` SQLite file
2. Each element → row in `elements` + row in `slide_elements` per slide
3. Images/demos → rows in `assets`
4. Keep original directory (non-destructive)

### Export to JSON directory

Extract current state → write presentation.json + asset files.

## Architecture

**Recommended: Rust side (Tauri)**

- `rusqlite` in the Tauri backend
- Frontend sends commands via `invoke()`
- Native speed, direct file access
- All DB operations are async IPC

If IPC overhead matters for drag (60fps), batch position updates client-side and flush on pointerup.

## Implementation Plan

1. Schema + migration (JSON → SQLite importer)
2. Read path: load presentation from SQLite
3. Write path: element updates, slide changes
4. Asset storage: images/demos as BLOBs
5. History UI: timeline browser, undo from DB
6. Thinning: exponential history pruning
7. CLI: read/write SQLite in tools/eigendeck.mjs
8. Export: SQLite → HTML, SQLite → JSON directory

## Open Questions

1. Zustand store as cache: keep full state in memory, SQLite as persistence? Or query SQLite on every read?

2. WAL mode creates `-wal` and `-shm` sidecar files (cleaned up on close). Use `PRAGMA journal_mode = DELETE` instead for true single-file?

3. Demo HTML files: store as assets (BLOBs) or keep external? BLOBs = single file. External = editable in text editor.

4. Keep JSON directory export on every save for LLM editing compatibility?

## Keeping Things in Sync

### Git hooks (`.githooks/`)

Install with: `git config core.hooksPath .githooks`

**pre-commit**:
- Warns if `src/types/presentation.ts` changed without updating `LLM-EDITING.md`
- Warns if SQL schema changed without updating `SQLITE_STORAGE.md`
- Reminds to test both GUI and CLI export when `exportCore.mjs` changes

**post-commit**:
- Auto-runs `bench-perf.mjs` when storage-related code changes
- Saves results to `tools/perf-results/` for tracking over time
- Non-blocking: failures don't prevent the commit

### Canonical conversion (toJSON / fromJSON)

All JSON interchange uses two functions (currently in `tools/bench-json-convert.mjs`, to be moved to `src/lib/sqliteStorage.ts`):

- **`toJSON(db)`**: SQLite → `Presentation` JSON object. Used by HTML export, CLI tools, LLM editing export.
- **`fromJSON(db, presentation, timestamp)`**: `Presentation` JSON → SQLite. Used by import, migration from JSON directories.

These are the ONLY bridge between the two formats. If the schema changes, update these functions and the round-trip test will catch mismatches.

### Performance tracking

```bash
# Run and save results
node tools/bench-perf.mjs --save tools/perf-results/

# Compare latest vs baseline
ls -t tools/perf-results/perf-*.json | head -2 | xargs -I{} jq '.results | to_entries[] | "\(.key): \(.value.median)ms"' {}
```

Results are JSON files with timestamps, medians, p95, p99. Check for regressions before merging schema changes.

### Test coverage

- `src/__tests__/llm-editing-sync.test.ts`: verifies LLM-EDITING.md covers all TypeScript types
- `tools/bench-json-convert.mjs`: verifies round-trip SQLite → JSON → SQLite
- `tools/bench-perf.mjs`: catches performance regressions
