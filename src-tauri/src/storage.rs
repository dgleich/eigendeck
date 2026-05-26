//! SQLite storage layer for Eigendeck presentations.
//!
//! All presentation data lives in a single `.eigendeck` SQLite file.
//! Uses a temporal data model: every change is timestamped with valid_from/valid_to.
//! Elements own their position. slide_elements is a junction table for sync.

use once_cell::sync::Lazy;
use rusqlite::{params, Connection, Result as SqlResult};
use serde_json::Value;
use std::sync::Mutex;

/// Global database connection (one per app instance)
static DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

/// Schema version for migration tracking
const SCHEMA_VERSION: i32 = 3;

/// Create the schema in a new database
pub fn create_schema(conn: &Connection) -> SqlResult<()> {
    // NOTE: the `assets` table + its indices are NOT created here. They
    // depend on the asset_id column existing, and old (pre-temporal) files
    // have a different-shape `assets` table that needs to be migrated
    // first. Creating the indices here would blow up the whole batch with
    // "no such column: asset_id" for those files, before migration could
    // run. Asset table + indices are created in the second execute_batch
    // below, after the migration block.
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS presentation (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS slides (
            id TEXT NOT NULL,
            position INTEGER,
            notes TEXT,
            group_id TEXT,
            -- Per-slide overrides as a JSON blob: optional fields like
            -- theme, titleFont, bodyFont, hypeFont (font ids from
            -- src/lib/fonts.ts). NULL when the slide has no overrides
            -- (the common case). Keys are absent when not set; we never
            -- write defaults here so the runtime cascade
            -- (element override -> slide override -> presentation default)
            -- resolves correctly.
            config TEXT,
            valid_from TEXT NOT NULL,
            valid_to TEXT,
            PRIMARY KEY (id, valid_from)
        );

        CREATE TABLE IF NOT EXISTS elements (
            id TEXT NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            link_id TEXT,
            valid_from TEXT NOT NULL,
            valid_to TEXT,
            PRIMARY KEY (id, valid_from)
        );

        CREATE TABLE IF NOT EXISTS slide_elements (
            slide_id TEXT NOT NULL,
            element_id TEXT NOT NULL,
            z_order INTEGER NOT NULL,
            valid_from TEXT NOT NULL,
            valid_to TEXT,
            PRIMARY KEY (slide_id, element_id, valid_from)
        );

        -- Cached MathJax SVG renders. Not part of the temporal model
        -- (no valid_from/valid_to) — purely a derived-output cache.
        -- The `key` is a stable hash of (tex, bundle, display, preamble).
        -- CLI export reads from here so headless rendering can produce
        -- per-preset math without spinning up iframes.
        CREATE TABLE IF NOT EXISTS math_cache (
            key TEXT PRIMARY KEY,
            tex TEXT NOT NULL,
            bundle TEXT NOT NULL,
            display INTEGER NOT NULL,
            preamble TEXT NOT NULL,
            svg TEXT NOT NULL,
            width TEXT,
            height TEXT,
            valign TEXT,
            rendered_at INTEGER DEFAULT (strftime('%s','now'))
        );

        -- Cached rasterizations of SVG / PDF / (future) demo snapshots.
        -- Like math_cache: derived-output table outside the temporal model.
        -- Keyed by (source_id, variant, width, height) so the same source
        -- can have multiple renders at different sizes/variants without
        -- collision. `variant` is currently always '_' for SVG/PDF single-
        -- page; reserved for future PDF page number ('p2') or demo
        -- configuration name ('converged') so adding those later needs no
        -- schema change.
        CREATE TABLE IF NOT EXISTS asset_cache (
            source_id TEXT NOT NULL,
            variant TEXT NOT NULL DEFAULT '_',
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            png BLOB NOT NULL,
            source_hash TEXT,
            rendered_at INTEGER DEFAULT (strftime('%s','now')),
            PRIMARY KEY (source_id, variant, width, height)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_cache_source ON asset_cache(source_id);

        CREATE INDEX IF NOT EXISTS idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_el_id ON elements(id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
        ",
    )?;

    // Migration: v1 → v2. Add `config` column (slide-scoped JSON blob,
    // mirrors presentation.config). Drop the dead `layout` column. Both
    // ALTER TABLE statements are idempotent in our flow: the ADD ignores
    // errors if the column already exists, and we check for `layout`'s
    // presence before dropping. Old slides have NULL config — they
    // inherit everything from the presentation defaults via the runtime
    // cascade, so no data shuffle is needed.
    let _ = conn.execute("ALTER TABLE slides ADD COLUMN config TEXT", []);
    let layout_exists: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('slides') WHERE name='layout'")
        .and_then(|mut stmt| stmt.exists([]))
        .unwrap_or(false);
    if layout_exists {
        let _ = conn.execute("ALTER TABLE slides DROP COLUMN layout", []);
    }

    // Migration: pre-temporal-assets schemas had assets PK = path with no
    // valid_from/valid_to/asset_id columns. SQLite can't ALTER PK in
    // place, so rename + recreate + INSERT...SELECT. Each existing row
    // becomes one current version of a new asset_id (UUID-shaped from
    // SQLite's randomblob).
    let assets_temporal: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('assets') WHERE name='asset_id'")
        .and_then(|mut stmt| stmt.exists([]))
        .unwrap_or(false);
    if !assets_temporal {
        // Only run if the old-shape `assets` table actually has rows-or-table.
        let old_exists: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('assets') WHERE name='path'")
            .and_then(|mut stmt| stmt.exists([]))
            .unwrap_or(false);
        if old_exists {
            conn.execute_batch(
                "BEGIN;
                 ALTER TABLE assets RENAME TO assets_legacy;
                 CREATE TABLE assets (
                     asset_id TEXT NOT NULL,
                     data BLOB NOT NULL,
                     mime_type TEXT,
                     size INTEGER,
                     hash TEXT,
                     path TEXT,
                     external_path TEXT,
                     external_mtime TEXT,
                     auto_reload TEXT,
                     created_at TEXT,
                     valid_from TEXT NOT NULL,
                     valid_to TEXT,
                     PRIMARY KEY (asset_id, valid_from)
                 );
                 INSERT INTO assets (asset_id, data, mime_type, size, hash, path, external_path, external_mtime, auto_reload, created_at, valid_from, valid_to)
                     SELECT lower(hex(randomblob(16))), data, mime_type, size, hash, path, external_path, external_mtime, NULL, created_at,
                            COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')), NULL
                     FROM assets_legacy;
                 DROP TABLE assets_legacy;
                 COMMIT;"
            )?;
        }
    }

    // Assets table + indices, post-migration so the asset_id column is
    // guaranteed to exist (whether from migration or fresh-create).
    //
    // Assets are temporal: PK is (asset_id, valid_from). asset_id is a
    // stable UUID assigned at first insert; path is a non-unique LABEL
    // (two assets CAN share a path — e.g. user takes two macOS
    // screenshots both named screenshot.png). db_store_asset is
    // transactional close-old + insert-new with SHA-256 hash dedup
    // (no-op when bytes don't actually differ). External-link fields
    // (external_path, external_mtime, auto_reload) describe the
    // source file on disk the file-watcher refreshes from; auto_reload
    // is an enum string ('on'/'off'/'default'='follow global pref').
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS assets (
             asset_id TEXT NOT NULL,
             data BLOB NOT NULL,
             mime_type TEXT,
             size INTEGER,
             hash TEXT,
             path TEXT,
             external_path TEXT,
             external_mtime TEXT,
             auto_reload TEXT,
             created_at TEXT,
             valid_from TEXT NOT NULL,
             valid_to TEXT,
             PRIMARY KEY (asset_id, valid_from)
         );
         CREATE INDEX IF NOT EXISTS idx_assets_current ON assets(asset_id) WHERE valid_to IS NULL;
         CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path) WHERE valid_to IS NULL;",
    )?;

    // Set schema version
    conn.execute(
        "INSERT OR REPLACE INTO _meta VALUES ('schema_version', ?1)",
        params![SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

/// Open or create a .eigendeck SQLite database on disk
pub fn open_db(path: &str) -> SqlResult<()> {
    let conn = Connection::open(path)?;
    create_schema(&conn)?;
    let mut db = DB.lock().unwrap();
    *db = Some(conn);
    Ok(())
}

/// Open an in-memory SQLite database (used before first save).
/// No-op if a DB is already open (prevents clobbering a file-backed DB).
pub fn open_memory_db() -> SqlResult<()> {
    let mut db = DB.lock().unwrap();
    if db.is_some() {
        return Ok(()); // Already have a DB open — don't clobber it
    }
    let conn = Connection::open_in_memory()?;
    create_schema(&conn)?;
    *db = Some(conn);
    Ok(())
}

/// Save the current in-memory DB to a file, then reopen from that file.
/// Uses SQLite's backup API for an atomic copy.
pub fn save_to_file(path: &str) -> SqlResult<()> {
    let mut db = DB.lock().unwrap();
    let src = db.as_ref().ok_or(rusqlite::Error::InvalidQuery)?;
    // Flush the lazily-generated project_id into _meta before backing up
    // so the saved file has the same id this session has been using.
    persist_pending_project_id(src)?;
    {
        let mut dest = Connection::open(path)?;
        let backup = rusqlite::backup::Backup::new(src, &mut dest)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(0), None)?;
        // dest closes on drop, flushing everything
    }
    // Now reopen from the file so future writes go to disk
    let conn = Connection::open(path)?;
    // WAL mode is already set in schema, but ensure it after reopen
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    *db = Some(conn);
    Ok(())
}

/// Close the database, checkpointing WAL for clean single file
pub fn close_db() -> SqlResult<()> {
    let mut db = DB.lock().unwrap();
    if let Some(conn) = db.take() {
        // Only checkpoint if it's a file-backed DB (not in-memory)
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        // Connection drops and closes here
    }
    // Drop any session-only pending project_id so the next db_open gets a
    // fresh id if its file has none.
    *PENDING_PROJECT_ID.lock().unwrap() = None;
    Ok(())
}

/// Build the slide.config JSON string from a Slide JSON value.
/// Returns None if the slide has no overrides (the common case) — we
/// never write defaults; absence is what makes the cascade work.
///
/// Currently extracts: theme, titleFont, bodyFont, hypeFont. New
/// override fields can be added here without a schema change.
fn build_slide_config_json(slide: &serde_json::Value) -> Option<String> {
    let mut out = serde_json::Map::new();
    for key in ["theme", "titleFont", "bodyFont", "hypeFont", "transition", "layout", "mathPreamble"] {
        if let Some(v) = slide.get(key) {
            // Only include if the value is meaningful (non-null, non-empty string).
            match v {
                serde_json::Value::Null => {}
                serde_json::Value::String(s) if s.is_empty() => {}
                _ => { out.insert(key.to_string(), v.clone()); }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(out).to_string())
    }
}

/// Splat a slide.config JSON string back onto a Slide object map.
/// No-op when config is None or "{}" — slide stays without overrides.
fn apply_slide_config_to_object(
    slide_obj: &mut serde_json::Map<String, serde_json::Value>,
    config: Option<&str>,
) {
    let Some(s) = config else { return };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(s) else { return };
    for (k, v) in map { slide_obj.insert(k, v); }
}

/// Generate a high-resolution timestamp for versioning
fn timestamp() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = chrono_lite_now();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{:08}", now, seq)
}

/// ISO 8601 UTC timestamp without chrono dependency.
/// Uses Howard Hinnant's civil_from_days algorithm for correct dates.
fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = (secs / 86400) as i64;

    // civil_from_days: days since epoch → (year, month, day)
    // https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, m, s, millis
    )
}

/// Execute a closure with the database connection
fn with_db<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> SqlResult<T>,
{
    let db = DB.lock().unwrap();
    let conn = db.as_ref().ok_or("No database open")?;
    f(conn).map_err(|e| e.to_string())
}

/// SHA-256 of bytes as lowercase hex. Used for asset content dedup
/// (db_store_asset skips inserting a new version when the new bytes
/// hash equals the current row's stored hash).
fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data);
    let mut out = String::with_capacity(64);
    for b in digest { out.push_str(&format!("{:02x}", b)); }
    out
}

// ============================================================================
// Project ID — stable identifier in _meta. Generated lazily: in-memory at
// db_open if the file has none; persisted to _meta only on save. Survives
// renames; changes on Save As (db_save_as_to_file generates fresh).
// Used as the WatcherRegistry key on the frontend so registries are robust
// across path changes.
// ============================================================================

static PENDING_PROJECT_ID: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Read the persisted project_id from _meta, or generate + park in memory.
/// Called by db_get_project_id (and by save paths to know what to persist).
fn read_or_generate_project_id(conn: &Connection) -> SqlResult<String> {
    let existing: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM _meta WHERE key = 'project_id'",
        [],
        |row| row.get(0),
    );
    match existing {
        Ok(id) => {
            // Already persisted; clear any stale pending value
            *PENDING_PROJECT_ID.lock().unwrap() = None;
            Ok(id)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Either reuse the pending value (so repeated calls during a
            // session see the same id) or generate fresh.
            let mut pending = PENDING_PROJECT_ID.lock().unwrap();
            if let Some(id) = pending.as_ref() {
                Ok(id.clone())
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                *pending = Some(id.clone());
                Ok(id)
            }
        }
        Err(e) => Err(e),
    }
}

/// On save, write the pending project_id into _meta if one was generated
/// in this session. Idempotent: no-op if _meta already has project_id.
fn persist_pending_project_id(conn: &Connection) -> SqlResult<()> {
    let pending = PENDING_PROJECT_ID.lock().unwrap().clone();
    if let Some(id) = pending {
        let already_persisted: bool = conn
            .query_row("SELECT 1 FROM _meta WHERE key = 'project_id'", [], |_| Ok(()))
            .is_ok();
        if !already_persisted {
            conn.execute(
                "INSERT INTO _meta (key, value) VALUES ('project_id', ?1)",
                params![&id],
            )?;
            *PENDING_PROJECT_ID.lock().unwrap() = None;
        }
    }
    Ok(())
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Open a .eigendeck file (or create if it doesn't exist)
#[tauri::command]
pub fn db_open(path: String) -> Result<(), String> {
    open_db(&path).map_err(|e| e.to_string())
}

/// Open an in-memory database (used on app start before first save)
#[tauri::command]
pub fn db_open_memory() -> Result<(), String> {
    open_memory_db().map_err(|e| e.to_string())
}

/// Save in-memory DB to a file, then reopen from file
#[tauri::command]
pub fn db_save_to_file(path: String) -> Result<(), String> {
    save_to_file(&path).map_err(|e| e.to_string())
}

/// Save the current DB to a new file as a FORK: the saved file gets a
/// fresh project_id (the in-memory DB also takes that fresh id, so the
/// app's running session continues as the new project). Caller chooses
/// whether to keep editing the new file or reopen the original.
#[tauri::command]
pub fn db_save_as_to_file(path: String) -> Result<String, String> {
    let fresh_id = uuid::Uuid::new_v4().to_string();
    with_db(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES ('project_id', ?1)",
            params![&fresh_id],
        )?;
        Ok(())
    })?;
    // Clear any pending — the fresh id is now persisted in the in-memory DB
    *PENDING_PROJECT_ID.lock().unwrap() = None;
    save_to_file(&path).map_err(|e| e.to_string())?;
    Ok(fresh_id)
}

/// Read the current project's stable id. If the file has none persisted,
/// generates one (UUID v4) and parks it in memory; it'll get written to
/// _meta on the next db_save_to_file. Survives renames (file-handle is
/// inode-based on macOS); changes on db_save_as_to_file.
#[tauri::command]
pub fn db_get_project_id() -> Result<String, String> {
    with_db(read_or_generate_project_id)
}

/// Close the current database
#[tauri::command]
pub fn db_close() -> Result<(), String> {
    close_db().map_err(|e| e.to_string())
}

/// Import a presentation.json into the open database
#[tauri::command]
pub fn db_import_json(json: String) -> Result<(), String> {
    let presentation: Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let ts = timestamp();

    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Clear existing data
        tx.execute_batch(
            "DELETE FROM presentation; DELETE FROM slides; DELETE FROM elements; DELETE FROM slide_elements;",
        )?;

        // Presentation metadata
        if let Some(title) = presentation.get("title").and_then(|v| v.as_str()) {
            tx.execute("INSERT INTO presentation VALUES ('title', ?1)", params![title])?;
        }
        if let Some(theme) = presentation.get("theme").and_then(|v| v.as_str()) {
            tx.execute("INSERT INTO presentation VALUES ('theme', ?1)", params![theme])?;
        }
        if let Some(config) = presentation.get("config") {
            tx.execute(
                "INSERT INTO presentation VALUES ('config', ?1)",
                params![config.to_string()],
            )?;
        }

        // Track synced elements (syncId → element_id in DB)
        let mut sync_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut inserted_elements: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        if let Some(slides) = presentation.get("slides").and_then(|v| v.as_array()) {
            for (i, slide) in slides.iter().enumerate() {
                let slide_id = slide
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let notes = slide.get("notes").and_then(|v| v.as_str()).unwrap_or("");
                let group_id = slide.get("groupId").and_then(|v| v.as_str());
                let config_json = build_slide_config_json(slide);

                tx.execute(
                    "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                    params![slide_id, i as i32, notes, group_id, config_json, &ts],
                )?;

                if let Some(elements) = slide.get("elements").and_then(|v| v.as_array()) {
                    for (z, el) in elements.iter().enumerate() {
                        let el_id = el
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let el_type = el
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("text");
                        let sync_id = el.get("syncId").and_then(|v| v.as_str());
                        let link_id = el.get("linkId").and_then(|v| v.as_str());

                        let element_id = el_id.clone();

                        // Handle synced elements
                        if let Some(sid) = sync_id {
                            if let Some(existing_id) = sync_map.get(sid) {
                                // Already inserted — just add junction row
                                tx.execute(
                                    "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
                                    params![slide_id, existing_id, z as i32, &ts],
                                )?;
                                continue;
                            }
                            sync_map.insert(sid.to_string(), element_id.clone());
                        }

                        if !inserted_elements.contains(&element_id) {
                            // Clean the data (strip sync/link fields — represented by schema)
                            let mut data = el.clone();
                            if let Some(obj) = data.as_object_mut() {
                                obj.remove("syncId");
                                obj.remove("_syncId");
                                obj.remove("_linkId");
                                obj.remove("linkId");
                            }

                            tx.execute(
                                "INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                                params![&element_id, el_type, data.to_string(), link_id, &ts],
                            )?;
                            inserted_elements.insert(element_id.clone());
                        }

                        tx.execute(
                            "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
                            params![slide_id, &element_id, z as i32, &ts],
                        )?;
                    }
                }
            }
        }

        tx.commit()?;
        Ok(())
    })
}

/// Export the current state to a Presentation JSON string
#[tauri::command]
pub fn db_export_json() -> Result<String, String> {
    with_db(|conn| {
        // Metadata
        let mut title = String::from("Untitled");
        let mut theme = String::from("white");
        let mut config = Value::Object(serde_json::Map::new());

        let mut stmt = conn.prepare("SELECT key, value FROM presentation")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "title" => title = value,
                "theme" => theme = value,
                "config" => {
                    config = serde_json::from_str(&value).unwrap_or(config);
                }
                _ => {}
            }
        }

        // All current elements
        let mut elements: std::collections::HashMap<String, (Value, Option<String>)> =
            std::collections::HashMap::new();
        let mut stmt = conn.prepare(
            "SELECT id, data, link_id FROM elements WHERE valid_to IS NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        for row in rows {
            let (id, data, link_id) = row?;
            let parsed: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
            elements.insert(id, (parsed, link_id));
        }

        // All current slide_elements + count appearances for sync detection
        let mut se_by_slide: std::collections::HashMap<String, Vec<(String, i32)>> =
            std::collections::HashMap::new();
        let mut el_count: std::collections::HashMap<String, i32> =
            std::collections::HashMap::new();

        let mut stmt = conn.prepare(
            "SELECT slide_id, element_id, z_order FROM slide_elements WHERE valid_to IS NULL ORDER BY slide_id, z_order",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
            ))
        })?;
        for row in rows {
            let (slide_id, element_id, z_order) = row?;
            se_by_slide
                .entry(slide_id)
                .or_default()
                .push((element_id.clone(), z_order));
            *el_count.entry(element_id).or_insert(0) += 1;
        }

        // Slides
        let mut slides_json = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT id, position, notes, group_id, config FROM slides WHERE valid_to IS NULL ORDER BY position",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        for row in rows {
            let (id, _position, notes, group_id, config) = row?;

            let mut slide_elements = Vec::new();
            if let Some(se_rows) = se_by_slide.get(&id) {
                for (element_id, _z_order) in se_rows {
                    if let Some((data, link_id)) = elements.get(element_id) {
                        let mut el = data.clone();
                        if let Some(obj) = el.as_object_mut() {
                            if let Some(lid) = link_id {
                                obj.insert("linkId".to_string(), Value::String(lid.clone()));
                            }
                            // If element appears on multiple slides, mark as synced
                            if el_count.get(element_id).copied().unwrap_or(0) > 1 {
                                obj.insert(
                                    "syncId".to_string(),
                                    Value::String(element_id.clone()),
                                );
                            }
                        }
                        slide_elements.push(el);
                    }
                }
            }

            let mut slide = serde_json::json!({
                "id": id,
                "elements": slide_elements,
                "notes": notes.unwrap_or_default(),
            });
            let slide_obj = slide.as_object_mut().unwrap();
            if let Some(gid) = group_id {
                slide_obj.insert("groupId".to_string(), Value::String(gid));
            }
            apply_slide_config_to_object(slide_obj, config.as_deref());
            slides_json.push(slide);
        }

        let presentation = serde_json::json!({
            "title": title,
            "theme": theme,
            "slides": slides_json,
            "config": config,
        });

        Ok(serde_json::to_string_pretty(&presentation).unwrap())
    })
}

/// Get all current slides (metadata only, for sidebar)
#[tauri::command]
pub fn db_get_slides() -> Result<String, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, position, notes, group_id, config FROM slides WHERE valid_to IS NULL ORDER BY position",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let position: i32 = row.get(1)?;
            let notes: Option<String> = row.get(2)?;
            let group_id: Option<String> = row.get(3)?;
            let config: Option<String> = row.get(4)?;
            let mut slide = serde_json::Map::new();
            slide.insert("id".to_string(), serde_json::json!(id));
            slide.insert("position".to_string(), serde_json::json!(position));
            slide.insert("notes".to_string(), serde_json::json!(notes));
            slide.insert("groupId".to_string(), serde_json::json!(group_id));
            apply_slide_config_to_object(&mut slide, config.as_deref());
            Ok(serde_json::Value::Object(slide))
        })?;
        let slides: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
        Ok(serde_json::to_string(&slides).unwrap())
    })
}

/// Get elements for a specific slide
#[tauri::command]
pub fn db_get_slide_elements(slide_id: String) -> Result<String, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.type, e.data, e.link_id, se.z_order
             FROM slide_elements se
             JOIN elements e ON e.id = se.element_id AND e.valid_to IS NULL
             WHERE se.slide_id = ?1 AND se.valid_to IS NULL
             ORDER BY se.z_order",
        )?;
        let rows = stmt.query_map(params![slide_id], |row| {
            let mut data: Value =
                serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(Value::Null);
            if let Some(obj) = data.as_object_mut() {
                if let Some(link_id) = row.get::<_, Option<String>>(3)? {
                    obj.insert("linkId".to_string(), Value::String(link_id));
                }
            }
            Ok(data)
        })?;
        let elements: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
        Ok(serde_json::to_string(&elements).unwrap())
    })
}

/// Update an element (creates a new version, closes the old one)
#[tauri::command]
pub fn db_update_element(id: String, data: String, link_id: Option<String>) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        // Get current type
        let el_type: String = tx.query_row(
            "SELECT type FROM elements WHERE id = ?1 AND valid_to IS NULL",
            params![&id],
            |row| row.get(0),
        )?;
        // Close old version
        tx.execute(
            "UPDATE elements SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
            params![&ts, &id],
        )?;
        // Insert new version
        tx.execute(
            "INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![&id, &el_type, &data, &link_id, &ts],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// Add a new element and place it on a slide
#[tauri::command]
pub fn db_add_element(
    slide_id: String,
    element_id: String,
    element_type: String,
    data: String,
    link_id: Option<String>,
    z_order: i32,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![&element_id, &element_type, &data, &link_id, &ts],
        )?;
        tx.execute(
            "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
            params![&slide_id, &element_id, z_order, &ts],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// Remove an element from a slide (but keep it in the DB for other slides)
#[tauri::command]
pub fn db_remove_element_from_slide(slide_id: String, element_id: String) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        conn.execute(
            "UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND element_id = ?3 AND valid_to IS NULL",
            params![&ts, &slide_id, &element_id],
        )?;
        Ok(())
    })
}

/// Get edit history — returns JSON array of events
#[tauri::command]
pub fn db_get_history(limit: i32) -> Result<String, String> {
    with_db(|conn| {
        let mut events: Vec<Value> = Vec::new();

        // Element changes
        let mut stmt = conn.prepare(
            "SELECT id, type, data, valid_from, valid_to FROM elements ORDER BY valid_from DESC LIMIT ?1"
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;

        for row in rows {
            let (id, el_type, data_str, valid_from, valid_to) = row?;
            let data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);
            let html = data.get("html").and_then(|v| v.as_str()).unwrap_or("");
            // Strip HTML tags for preview
            let text: String = {
                let mut r = String::new();
                let mut in_tag = false;
                for c in html.chars() {
                    if c == '<' { in_tag = true; }
                    else if c == '>' { in_tag = false; }
                    else if !in_tag { r.push(c); }
                }
                r.replace("&nbsp;", " ").replace("&amp;", "&")
            };
            let preview = if text.chars().count() > 60 {
                let s: String = text.chars().take(60).collect();
                format!("{}...", s)
            } else { text };

            let is_current = valid_to.is_none();
            // Check if this is a creation or update
            let is_creation: bool = conn.query_row(
                "SELECT COUNT(*) = 0 FROM elements WHERE id = ?1 AND valid_from < ?2",
                params![&id, &valid_from],
                |row| row.get(0),
            ).unwrap_or(true);

            let action = if is_creation { "create" } else if is_current { "update" } else { "closed" };

            events.push(serde_json::json!({
                "timestamp": valid_from,
                "action": action,
                "elementId": id,
                "elementType": el_type,
                "preset": data.get("preset").and_then(|v| v.as_str()),
                "preview": preview,
                "current": is_current,
            }));
        }

        // Reverse so oldest first
        events.reverse();

        Ok(serde_json::to_string_pretty(&events).unwrap())
    })
}

/// Get distinct history timestamps for the timeline scrubber.
/// Returns JSON array of { timestamp, summary } objects.
#[tauri::command]
pub fn db_get_history_timestamps() -> Result<String, String> {
    with_db(|conn| {
        // Collect all timestamps from all temporal tables
        let mut timestamps: Vec<(String, String)> = Vec::new();

        // Element changes
        let mut stmt = conn.prepare(
            "SELECT valid_from, id, type, data FROM elements ORDER BY valid_from"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        for row in rows {
            let (ts, _id, el_type, data_str) = row?;
            let data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);
            let preview = data.get("html").and_then(|v| v.as_str()).unwrap_or("");
            // Strip tags
            let text: String = {
                let mut r = String::new();
                let mut in_tag = false;
                for c in preview.chars().take(80) {
                    if c == '<' { in_tag = true; }
                    else if c == '>' { in_tag = false; }
                    else if !in_tag { r.push(c); }
                }
                r.replace("&nbsp;", " ").replace("&amp;", "&")
            };
            let summary = if text.is_empty() {
                format!("{} element", el_type)
            } else if text.chars().count() > 40 {
                let s: String = text.chars().take(40).collect();
                format!("{}: {}...", el_type, s)
            } else {
                format!("{}: {}", el_type, text)
            };
            timestamps.push((ts, summary));
        }

        // Slide changes
        let mut stmt = conn.prepare(
            "SELECT valid_from, id, position FROM slides ORDER BY valid_from"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
            ))
        })?;
        for row in rows {
            let (ts, _id, pos) = row?;
            timestamps.push((ts, format!("slide {}", pos + 1)));
        }

        // Sort by timestamp, deduplicate consecutive identical timestamps
        timestamps.sort_by(|a, b| a.0.cmp(&b.0));

        // Group by base timestamp (strip sequence suffix for display)
        let mut result: Vec<Value> = Vec::new();
        let mut last_ts = String::new();
        for (ts, summary) in &timestamps {
            if *ts != last_ts {
                result.push(serde_json::json!({
                    "timestamp": ts,
                    "summary": summary,
                }));
                last_ts = ts.clone();
            }
        }

        Ok(serde_json::to_string(&result).unwrap())
    })
}

/// Reconstruct the full presentation state as it was at a given timestamp.
/// Uses temporal queries: valid_from <= ts AND (valid_to IS NULL OR valid_to > ts).
#[tauri::command]
pub fn db_get_state_at(at: String) -> Result<String, String> {
    with_db(|conn| {
        // Metadata (not temporal — use current)
        let mut title = String::from("Untitled");
        let mut theme = String::from("white");
        let mut config = Value::Object(serde_json::Map::new());

        let mut stmt = conn.prepare("SELECT key, value FROM presentation")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "title" => title = value,
                "theme" => theme = value,
                "config" => {
                    config = serde_json::from_str(&value).unwrap_or(config);
                }
                _ => {}
            }
        }

        // Elements alive at `at`
        let mut elements: std::collections::HashMap<String, (Value, Option<String>)> =
            std::collections::HashMap::new();
        let mut stmt = conn.prepare(
            "SELECT id, data, link_id FROM elements WHERE valid_from <= ?1 AND (valid_to IS NULL OR valid_to > ?1)"
        )?;
        let rows = stmt.query_map(params![&at], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        for row in rows {
            let (id, data, link_id) = row?;
            let parsed: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
            elements.insert(id, (parsed, link_id));
        }

        // slide_elements alive at `at`
        let mut se_by_slide: std::collections::HashMap<String, Vec<(String, i32)>> =
            std::collections::HashMap::new();
        let mut el_count: std::collections::HashMap<String, i32> =
            std::collections::HashMap::new();

        let mut stmt = conn.prepare(
            "SELECT slide_id, element_id, z_order FROM slide_elements WHERE valid_from <= ?1 AND (valid_to IS NULL OR valid_to > ?1) ORDER BY slide_id, z_order"
        )?;
        let rows = stmt.query_map(params![&at], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
            ))
        })?;
        for row in rows {
            let (slide_id, element_id, z_order) = row?;
            se_by_slide
                .entry(slide_id)
                .or_default()
                .push((element_id.clone(), z_order));
            *el_count.entry(element_id).or_insert(0) += 1;
        }

        // Slides alive at `at`
        let mut slides_json = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT id, position, notes, group_id, config FROM slides WHERE valid_from <= ?1 AND (valid_to IS NULL OR valid_to > ?1) ORDER BY position"
        )?;
        let rows = stmt.query_map(params![&at], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        for row in rows {
            let (id, _position, notes, group_id, config) = row?;
            let mut slide_elements = Vec::new();
            if let Some(se_rows) = se_by_slide.get(&id) {
                for (element_id, _z_order) in se_rows {
                    if let Some((data, link_id)) = elements.get(element_id) {
                        let mut el = data.clone();
                        if let Some(obj) = el.as_object_mut() {
                            if let Some(lid) = link_id {
                                obj.insert("linkId".to_string(), Value::String(lid.clone()));
                            }
                            if el_count.get(element_id).copied().unwrap_or(0) > 1 {
                                obj.insert("syncId".to_string(), Value::String(element_id.clone()));
                            }
                        }
                        slide_elements.push(el);
                    }
                }
            }

            let mut slide = serde_json::json!({
                "id": id,
                "elements": slide_elements,
                "notes": notes.unwrap_or_default(),
            });
            let slide_obj = slide.as_object_mut().unwrap();
            if let Some(gid) = group_id {
                slide_obj.insert("groupId".to_string(), Value::String(gid));
            }
            apply_slide_config_to_object(slide_obj, config.as_deref());
            slides_json.push(slide);
        }

        let presentation = serde_json::json!({
            "title": title,
            "theme": theme,
            "slides": slides_json,
            "config": config,
        });

        Ok(serde_json::to_string(&presentation).unwrap())
    })
}

/// Checkpoint WAL — merges WAL into main DB file, shrinks sidecar files
#[tauri::command]
pub fn db_checkpoint() -> Result<(), String> {
    with_db(|conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);")?;
        Ok(())
    })
}

/// Compact: delete old history and VACUUM
#[tauri::command]
pub fn db_compact(keep_all: bool) -> Result<String, String> {
    with_db(|conn| {
        let before_size = {
            let mut stmt = conn.prepare("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()")?;
            stmt.query_row([], |row| row.get::<_, i64>(0)).unwrap_or(0)
        };

        if keep_all {
            // Delete ALL history
            conn.execute_batch(
                "DELETE FROM elements WHERE valid_to IS NOT NULL;
                 DELETE FROM slide_elements WHERE valid_to IS NOT NULL;
                 DELETE FROM slides WHERE valid_to IS NOT NULL;",
            )?;
        } else {
            // Exponential thinning (keep recent, thin old)
            // For now, just delete history older than 1 hour
            conn.execute_batch(
                "DELETE FROM elements WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');
                 DELETE FROM slide_elements WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');
                 DELETE FROM slides WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');",
            )?;
        }

        conn.execute_batch("VACUUM;")?;

        let after_size = {
            let mut stmt = conn.prepare("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()")?;
            stmt.query_row([], |row| row.get::<_, i64>(0)).unwrap_or(0)
        };

        Ok(serde_json::json!({
            "beforeBytes": before_size,
            "afterBytes": after_size,
            "savedBytes": before_size - after_size,
        })
        .to_string())
    })
}

// ============================================================================
// Slide operations
// ============================================================================

/// Add a new slide at a given position
#[tauri::command]
pub fn db_add_slide(
    id: String,
    position: i32,
    group_id: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        conn.execute(
            "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
             VALUES (?1, ?2, '', ?3, NULL, ?4, NULL)",
            params![&id, position, &group_id, &ts],
        )?;
        Ok(())
    })
}

/// Delete a slide (close it and all its element references)
#[tauri::command]
pub fn db_delete_slide(slide_id: String) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
            params![&ts, &slide_id],
        )?;
        tx.execute(
            "UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND valid_to IS NULL",
            params![&ts, &slide_id],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// Duplicate a slide: create new slide + copy all element references (synced)
#[tauri::command]
pub fn db_duplicate_slide(
    source_slide_id: String,
    new_slide_id: String,
    new_position: i32,
    group_id: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Get source slide metadata (notes, group_id, config carried over)
        let (notes, src_group, config): (String, Option<String>, Option<String>) = tx.query_row(
            "SELECT notes, group_id, config FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&source_slide_id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            )),
        )?;

        let final_group_id = group_id.or(src_group);

        // Create new slide (carries over notes + config from source)
        tx.execute(
            "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![&new_slide_id, new_position, &notes, &final_group_id, &config, &ts],
        )?;

        // Copy all slide_element references (same elements = synced)
        tx.execute(
            "INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from)
             SELECT ?1, element_id, z_order, ?2
             FROM slide_elements WHERE slide_id = ?3 AND valid_to IS NULL",
            params![&new_slide_id, &ts, &source_slide_id],
        )?;

        tx.commit()?;
        Ok(())
    })
}

/// Move a slide to a new position (reorder)
#[tauri::command]
pub fn db_move_slide(slide_id: String, new_position: i32) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Carry over the rest of the slide's data unchanged
        let (notes, group_id, config): (String, Option<String>, Option<String>) = tx.query_row(
            "SELECT notes, group_id, config FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&slide_id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            )),
        )?;

        // Close old version
        tx.execute(
            "UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
            params![&ts, &slide_id],
        )?;

        // Insert new version with updated position
        tx.execute(
            "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![&slide_id, new_position, &notes, &group_id, &config, &ts],
        )?;

        tx.commit()?;
        Ok(())
    })
}

/// Update slide metadata (notes, group_id, position, config).
///
/// `config` is an optional JSON string holding per-slide overrides like
/// `{"theme":"dark","titleFont":"shantell"}`. Pass an empty/absent JSON
/// to clear all overrides — the helper that builds it (see TS subscriber)
/// returns null when no fields are set, which we store as SQL NULL so the
/// runtime cascade fires correctly.
#[tauri::command]
pub fn db_update_slide(
    slide_id: String,
    position: Option<i32>,
    notes: Option<String>,
    group_id: Option<String>,
    config: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Get current values to fill in fields the caller didn't pass
        let (cur_pos, cur_notes, cur_group, cur_config): (i32, String, Option<String>, Option<String>) = tx.query_row(
            "SELECT position, notes, group_id, config FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&slide_id],
            |row| Ok((
                row.get(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            )),
        )?;

        // Close old
        tx.execute(
            "UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
            params![&ts, &slide_id],
        )?;

        // For config: caller passes Some(json) to set, Some("") to clear,
        // None to leave unchanged. Treat empty string as "clear" so the
        // TS subscriber can use it as a sentinel for "no overrides now".
        let new_config: Option<String> = match config {
            Some(s) if s.is_empty() => None,
            Some(s) => Some(s),
            None => cur_config,
        };

        // Insert updated
        tx.execute(
            "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                &slide_id,
                position.unwrap_or(cur_pos),
                notes.as_deref().unwrap_or(&cur_notes),
                group_id.or(cur_group),
                new_config,
                &ts
            ],
        )?;

        tx.commit()?;
        Ok(())
    })
}

/// Update z-order of an element on a slide
#[tauri::command]
pub fn db_update_z_order(
    slide_id: String,
    element_id: String,
    new_z_order: i32,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        // Close old
        tx.execute(
            "UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND element_id = ?3 AND valid_to IS NULL",
            params![&ts, &slide_id, &element_id],
        )?;
        // Insert new
        tx.execute(
            "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
            params![&slide_id, &element_id, new_z_order, &ts],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// Free a synced element: duplicate it so one slide gets its own copy
#[tauri::command]
pub fn db_free_element(
    slide_id: String,
    element_id: String,
    new_element_id: String,
    link_id: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Get current element data
        let (el_type, data): (String, String) = tx.query_row(
            "SELECT type, data FROM elements WHERE id = ?1 AND valid_to IS NULL",
            params![&element_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        // Get current z_order
        let z_order: i32 = tx.query_row(
            "SELECT z_order FROM slide_elements WHERE slide_id = ?1 AND element_id = ?2 AND valid_to IS NULL",
            params![&slide_id, &element_id],
            |row| row.get(0),
        )?;

        // Create copy of element
        tx.execute(
            "INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![&new_element_id, &el_type, &data, &link_id, &ts],
        )?;

        // Remove old reference from this slide
        tx.execute(
            "UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND element_id = ?3 AND valid_to IS NULL",
            params![&ts, &slide_id, &element_id],
        )?;

        // Add new reference
        tx.execute(
            "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
            params![&slide_id, &new_element_id, z_order, &ts],
        )?;

        tx.commit()?;
        Ok(())
    })
}

/// Store an asset (image/demo) as a BLOB.
///
/// `external_path` (optional) records where the asset originated relative
/// to the .eigendeck file's directory. When present, the file-watcher
/// hook auto-reloads the asset bytes when the source file changes on
/// disk. Pass `None` to clear the link (e.g. after the user accepts an
/// auto-embed snapshot — the asset is now self-contained).
///
/// `external_mtime` (optional) is the source file's mtime at last load,
/// stored alongside for staleness detection in non-watch contexts.
/// Store an asset blob. Versioning behavior:
///
///   * If `asset_id` is given AND the current row at that id has the
///     same SHA-256 as the new bytes -> no-op (dedup).
///   * If `asset_id` is given AND hash differs -> close current
///     (`valid_to = now`) and INSERT a new row with `valid_from = now`.
///   * If `asset_id` is `None`, fall back to legacy path-keyed behavior:
///     look up the current row whose `path` matches; reuse that
///     `asset_id` if found, else generate a fresh UUID.
///
/// Path is a non-unique display label — two assets CAN share it (e.g.
/// two `screenshot.png` imports the user chose to keep separate).
/// All writes are wrapped in a transaction.
///
/// Returns the asset_id that was written to (whether passed-in or
/// generated). Frontend callers should remember it on the element so
/// subsequent reads / restores target the same identity.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn db_store_asset(
    path: String,
    data: Vec<u8>,
    mime_type: String,
    external_path: Option<String>,
    external_mtime: Option<String>,
    asset_id: Option<String>,
    auto_reload: Option<String>,
) -> Result<String, String> {
    with_db(|conn| {
        let new_hash = sha256_hex(&data);
        let size = data.len() as i64;
        let now = timestamp();

        // Determine asset_id: explicit > legacy-path-lookup > fresh UUID.
        //
        // FOOTGUN: the legacy-path-lookup branch only does the "expected"
        // thing (fresh UUID) when the path is BRAND NEW. If the path
        // already has an asset, this branch silently REUSES that
        // asset_id — which is wrong when the caller actually wants a
        // separate asset at the same path (e.g. the collision-dialog
        // 'revert + add as new version' flow). Callers that need
        // guaranteed-fresh asset_id at an existing path MUST generate a
        // UUID themselves (crypto.randomUUID on JS side) and pass it via
        // the explicit branch. See src/lib/assetInsert.ts for the
        // canonical example. Bit us once; left this branch in place
        // because clipboard paste / drag with synthetic paths
        // (pasted-<ts>.svg, dropped-<ts>.svg) relies on the fresh-UUID
        // fallback for genuinely new paths.
        let id: String = if let Some(id) = asset_id {
            id
        } else {
            let by_path: rusqlite::Result<String> = conn.query_row(
                "SELECT asset_id FROM assets WHERE path = ?1 AND valid_to IS NULL \
                 ORDER BY valid_from DESC LIMIT 1",
                params![&path], |row| row.get(0),
            );
            match by_path {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => uuid::Uuid::new_v4().to_string(),
                Err(e) => return Err(e),
            }
        };

        // Hash dedup: if current row for this asset_id matches the new
        // bytes, this is a no-op (covers watcher storms + redundant
        // re-saves that don't actually change content).
        let current_hash: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT hash FROM assets WHERE asset_id = ?1 AND valid_to IS NULL",
            params![&id], |row| row.get(0),
        );
        if let Ok(Some(h)) = current_hash {
            if h == new_hash { return Ok(id); }
        }

        // Transactional close-old + insert-new.
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE assets SET valid_to = ?1 WHERE asset_id = ?2 AND valid_to IS NULL",
            params![&now, &id],
        )?;
        tx.execute(
            "INSERT INTO assets (asset_id, data, mime_type, size, hash, path, \
             external_path, external_mtime, auto_reload, created_at, valid_from, valid_to) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)",
            params![&id, &data, &mime_type, size, &new_hash, &path,
                    &external_path, &external_mtime, &auto_reload, &now, &now],
        )?;
        tx.commit()?;
        Ok(id)
    })
}

/// Read the current bytes of an asset by its path label (legacy lookup).
/// When two assets share the same path (allowed), returns the most
/// recently created one. New callers should prefer `db_get_asset_by_id`.
#[tauri::command]
pub fn db_get_asset(path: String) -> Result<Vec<u8>, String> {
    with_db(|conn| {
        conn.query_row(
            "SELECT data FROM assets WHERE path = ?1 AND valid_to IS NULL \
             ORDER BY valid_from DESC LIMIT 1",
            params![&path],
            |row| row.get(0),
        )
    })
}

/// Read the current bytes of a specific asset by its stable asset_id.
#[tauri::command]
pub fn db_get_asset_by_id(asset_id: String) -> Result<Vec<u8>, String> {
    with_db(|conn| {
        conn.query_row(
            "SELECT data FROM assets WHERE asset_id = ?1 AND valid_to IS NULL",
            params![&asset_id],
            |row| row.get(0),
        )
    })
}

/// Return the asset's `external_path` (source link relative to the
/// .eigendeck dir) if present, else None. Used by the file-watcher hook
/// to know whether/where to watch. Legacy path-keyed lookup; new callers
/// should use `db_get_asset_external_path_by_id`.
#[tauri::command]
pub fn db_get_asset_external_path(path: String) -> Result<Option<String>, String> {
    with_db(|conn| {
        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT external_path FROM assets WHERE path = ?1 AND valid_to IS NULL \
             ORDER BY valid_from DESC LIMIT 1",
            params![&path],
            |row| row.get(0),
        );
        match result {
            Ok(p) => Ok(p),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

#[derive(serde::Serialize)]
pub struct AssetMeta {
    pub asset_id: String,
    pub path: Option<String>,
    pub external_path: Option<String>,
    pub external_mtime: Option<String>,
    pub mime_type: Option<String>,
    pub auto_reload: Option<String>,
    /// SHA-256 hex of the current row's bytes. Lets the JS-side
    /// collision check skip the dialog when the new insertion has
    /// the same bytes as the existing asset (dedup is already a
    /// no-op in db_store_asset; the dialog would just be annoying).
    pub hash: Option<String>,
}

/// Look up the current asset row matching a given path label. Returns
/// every field the file-watcher needs (asset_id, external_path,
/// external_mtime, mime, auto_reload) in one call so the hook can pass
/// the REAL asset_id to db_store_asset on a disk event (not a fake
/// path-derived placeholder, which would create orphan rows).
///
/// Returns None when no current asset matches the path.
/// Use db_get_asset_meta_by_id when the caller has an asset_id; that's
/// the correct lookup when multiple assets may share a path label.
#[tauri::command]
pub fn db_get_asset_meta_by_path(path: String) -> Result<Option<AssetMeta>, String> {
    with_db(|conn| {
        let result: rusqlite::Result<AssetMeta> = conn.query_row(
            "SELECT asset_id, path, external_path, external_mtime, mime_type, auto_reload, hash \
             FROM assets WHERE path = ?1 AND valid_to IS NULL \
             ORDER BY valid_from DESC LIMIT 1",
            params![&path],
            |row| Ok(AssetMeta {
                asset_id: row.get(0)?,
                path: row.get(1)?,
                external_path: row.get(2)?,
                external_mtime: row.get(3)?,
                mime_type: row.get(4)?,
                auto_reload: row.get(5)?,
                hash: row.get(6)?,
            }),
        );
        match result {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

/// Look up the current asset row by stable asset_id. Same shape as
/// db_get_asset_meta_by_path but always unambiguous — preferred by the
/// renderer/watcher hooks when the element has an assetId binding.
#[tauri::command]
pub fn db_get_asset_meta_by_id(asset_id: String) -> Result<Option<AssetMeta>, String> {
    with_db(|conn| {
        let result: rusqlite::Result<AssetMeta> = conn.query_row(
            "SELECT asset_id, path, external_path, external_mtime, mime_type, auto_reload, hash \
             FROM assets WHERE asset_id = ?1 AND valid_to IS NULL",
            params![&asset_id],
            |row| Ok(AssetMeta {
                asset_id: row.get(0)?,
                path: row.get(1)?,
                external_path: row.get(2)?,
                external_mtime: row.get(3)?,
                mime_type: row.get(4)?,
                auto_reload: row.get(5)?,
                hash: row.get(6)?,
            }),
        );
        match result {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

#[derive(serde::Serialize)]
pub struct AssetVersion {
    pub asset_id: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub size: i64,
    pub hash: Option<String>,
    pub mime_type: Option<String>,
    pub external_mtime: Option<String>,
}

/// Full version history for an asset_id, newest first. Used by the
/// Properties panel to show the version timeline + Restore buttons.
#[tauri::command]
pub fn db_get_asset_history(asset_id: String) -> Result<Vec<AssetVersion>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT asset_id, valid_from, valid_to, size, hash, mime_type, external_mtime \
             FROM assets WHERE asset_id = ?1 ORDER BY valid_from DESC",
        )?;
        let rows = stmt.query_map(params![&asset_id], |row| Ok(AssetVersion {
            asset_id: row.get(0)?,
            valid_from: row.get(1)?,
            valid_to: row.get(2)?,
            size: row.get(3)?,
            hash: row.get(4)?,
            mime_type: row.get(5)?,
            external_mtime: row.get(6)?,
        }))?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

/// Restore an old version of an asset as the current one. Creates a new
/// row (same asset_id) with the old bytes; closes the current. Sets
/// auto_reload='off' on the restored version so the file watcher won't
/// In-place flag flip on the current asset row — sets/clears auto_reload
/// WITHOUT creating a new version (which would burn a row + force any
/// listening hooks to re-fetch unnecessarily). `value` accepts 'on'
/// (explicit watch), 'off' (explicit no-watch), or None (follow the
/// global preference). Used by the Properties panel's auto-reload tri-
/// state toggle.
#[tauri::command]
pub fn db_set_asset_auto_reload(asset_id: String, value: Option<String>) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE assets SET auto_reload = ?1 WHERE asset_id = ?2 AND valid_to IS NULL",
            params![&value, &asset_id],
        )?;
        Ok(())
    })
}

/// immediately overwrite the restore on the next disk-event. Transactional.
#[tauri::command]
pub fn db_restore_asset_version(asset_id: String, valid_from: String) -> Result<(), String> {
    with_db(|conn| {
        let now = timestamp();
        let tx = conn.unchecked_transaction()?;
        // Snapshot the target version's data + metadata.
        let (data, mime_type, size, hash, path, external_path, external_mtime):
            (Vec<u8>, Option<String>, i64, Option<String>, Option<String>, Option<String>, Option<String>)
            = tx.query_row(
                "SELECT data, mime_type, size, hash, path, external_path, external_mtime \
                 FROM assets WHERE asset_id = ?1 AND valid_from = ?2",
                params![&asset_id, &valid_from],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
            )?;
        // Close any current row for this asset_id.
        tx.execute(
            "UPDATE assets SET valid_to = ?1 WHERE asset_id = ?2 AND valid_to IS NULL",
            params![&now, &asset_id],
        )?;
        // Insert the restored version as the new current; auto_reload='off'
        // ensures the file watcher won't trample the restore on the next
        // disk event.
        tx.execute(
            "INSERT INTO assets (asset_id, data, mime_type, size, hash, path, \
             external_path, external_mtime, auto_reload, created_at, valid_from, valid_to) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'off', ?9, ?9, NULL)",
            params![&asset_id, &data, &mime_type, size, &hash, &path,
                    &external_path, &external_mtime, &now],
        )?;
        tx.commit()?;
        Ok(())
    })
}

#[derive(serde::Serialize)]
pub struct LinkedAsset {
    pub asset_id: String,
    pub path: Option<String>,
    pub external_path: String,
    pub external_mtime: Option<String>,
    pub auto_reload: Option<String>,
    pub size: i64,
    pub hash: Option<String>,
    pub mime_type: Option<String>,
}

/// Every current asset that has a source-file link. Used by the
/// `scanForChangedAssets` startup pass (compare disk mtime vs stored
/// external_mtime, reload changed ones) and by the WatcherRegistry to
/// bootstrap its watch set after a project opens.
#[tauri::command]
pub fn db_list_linked_assets() -> Result<Vec<LinkedAsset>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT asset_id, path, external_path, external_mtime, auto_reload, size, hash, mime_type \
             FROM assets WHERE valid_to IS NULL AND external_path IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok(LinkedAsset {
            asset_id: row.get(0)?,
            path: row.get(1)?,
            external_path: row.get(2)?,
            external_mtime: row.get(3)?,
            auto_reload: row.get(4)?,
            size: row.get(5)?,
            hash: row.get(6)?,
            mime_type: row.get(7)?,
        }))?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

// ============================================
// Math SVG cache (not historied)
// ============================================
//
// The renderer iframe pool writes through to this cache so headless tools
// (CLI export) can produce per-preset math without spinning up iframes
// themselves. The `key` is computed in the TS side as a stable hash of
// (tex, bundle, display, preamble).

#[derive(serde::Serialize)]
pub struct MathCacheEntry {
    pub key: String,
    pub tex: String,
    pub bundle: String,
    pub display: bool,
    pub preamble: String,
    pub svg: String,
    pub width: Option<String>,
    pub height: Option<String>,
    pub valign: Option<String>,
}

/// Insert or update a cached math SVG render.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn db_put_math_svg(
    key: String,
    tex: String,
    bundle: String,
    display: bool,
    preamble: String,
    svg: String,
    width: Option<String>,
    height: Option<String>,
    valign: Option<String>,
) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO math_cache (key, tex, bundle, display, preamble, svg, width, height, valign) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![&key, &tex, &bundle, display as i64, &preamble, &svg, &width, &height, &valign],
        )?;
        Ok(())
    })
}

/// Look up one cached SVG by its key. Returns None if not cached.
#[tauri::command]
pub fn db_get_math_svg(key: String) -> Result<Option<MathCacheEntry>, String> {
    with_db(|conn| {
        let result: rusqlite::Result<MathCacheEntry> = conn.query_row(
            "SELECT key, tex, bundle, display, preamble, svg, width, height, valign \
             FROM math_cache WHERE key = ?1",
            params![&key],
            |row| Ok(MathCacheEntry {
                key: row.get(0)?,
                tex: row.get(1)?,
                bundle: row.get(2)?,
                display: row.get::<_, i64>(3)? != 0,
                preamble: row.get(4)?,
                svg: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                valign: row.get(8)?,
            }),
        );
        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

/// Load the entire cache (used at boot to warm the in-memory pool caches).
#[tauri::command]
pub fn db_load_math_cache() -> Result<Vec<MathCacheEntry>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT key, tex, bundle, display, preamble, svg, width, height, valign FROM math_cache",
        )?;
        let rows = stmt.query_map([], |row| Ok(MathCacheEntry {
            key: row.get(0)?,
            tex: row.get(1)?,
            bundle: row.get(2)?,
            display: row.get::<_, i64>(3)? != 0,
            preamble: row.get(4)?,
            svg: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
            valign: row.get(8)?,
        }))?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

// ============================================================================
// Asset cache: rasterized SVG / PDF / (future) demo snapshots.
// ============================================================================

// Field names are snake_case on the wire (matches the MathCacheEntry pattern
// already consumed by the frontend); the TS wrapper module mirrors them.
#[derive(serde::Serialize)]
pub struct AssetCacheEntry {
    pub source_id: String,
    pub variant: String,
    pub width: i64,
    pub height: i64,
    /// PNG bytes — Tauri serializes Vec<u8> as a JSON number array on the wire.
    pub png: Vec<u8>,
    pub source_hash: Option<String>,
}

#[derive(serde::Serialize)]
pub struct AssetCacheVariant {
    pub variant: String,
    pub width: i64,
    pub height: i64,
    pub source_hash: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn db_put_asset_cache(
    source_id: String,
    variant: String,
    width: i64,
    height: i64,
    png: Vec<u8>,
    source_hash: Option<String>,
) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO asset_cache (source_id, variant, width, height, png, source_hash) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![&source_id, &variant, width, height, &png, &source_hash],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_get_asset_cache(
    source_id: String,
    variant: String,
    width: i64,
    height: i64,
) -> Result<Option<AssetCacheEntry>, String> {
    with_db(|conn| {
        let result: rusqlite::Result<AssetCacheEntry> = conn.query_row(
            "SELECT source_id, variant, width, height, png, source_hash \
             FROM asset_cache WHERE source_id = ?1 AND variant = ?2 AND width = ?3 AND height = ?4",
            params![&source_id, &variant, width, height],
            |row| Ok(AssetCacheEntry {
                source_id: row.get(0)?,
                variant: row.get(1)?,
                width: row.get(2)?,
                height: row.get(3)?,
                png: row.get(4)?,
                source_hash: row.get(5)?,
            }),
        );
        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

/// List every cached variant (with size + hash) for a source. Lets callers
/// pick the best existing render for a requested size before triggering a
/// fresh one.
#[tauri::command]
pub fn db_list_asset_cache_variants(source_id: String) -> Result<Vec<AssetCacheVariant>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT variant, width, height, source_hash FROM asset_cache WHERE source_id = ?1",
        )?;
        let rows = stmt.query_map(params![&source_id], |row| Ok(AssetCacheVariant {
            variant: row.get(0)?,
            width: row.get(1)?,
            height: row.get(2)?,
            source_hash: row.get(3)?,
        }))?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

/// Drop every cached render for a source (e.g. after the source file
/// changed). Returns the number of rows removed.
#[tauri::command]
pub fn db_clear_asset_cache(source_id: String) -> Result<i64, String> {
    with_db(|conn| {
        let n = conn.execute(
            "DELETE FROM asset_cache WHERE source_id = ?1",
            params![&source_id],
        )?;
        Ok(n as i64)
    })
}

/// Update presentation metadata
#[tauri::command]
pub fn db_update_presentation(key: String, value: String) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO presentation VALUES (?1, ?2)",
            params![&key, &value],
        )?;
        Ok(())
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Set the global DB to an in-memory connection with schema created.
    fn setup_global_db() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let mut db = DB.lock().unwrap();
        *db = Some(conn);
    }

    /// Tear down the global DB.
    fn teardown_global_db() {
        let mut db = DB.lock().unwrap();
        *db = None;
    }

    /// A minimal presentation JSON for testing.
    fn sample_presentation() -> String {
        json!({
            "title": "Test Presentation",
            "theme": "dark",
            "config": { "aspectRatio": "16:9" },
            "slides": [
                {
                    "id": "slide-1",
                    "layout": "default",
                    "notes": "Speaker notes here",
                    "elements": [
                        {
                            "id": "el-1",
                            "type": "text",
                            "x": 100, "y": 50, "width": 400, "height": 80,
                            "content": "Hello world"
                        },
                        {
                            "id": "el-2",
                            "type": "image",
                            "x": 200, "y": 200, "width": 300, "height": 300,
                            "src": "test.png"
                        }
                    ]
                },
                {
                    "id": "slide-2",
                    "layout": "centered",
                    "notes": "",
                    "groupId": "group-A",
                    "elements": [
                        {
                            "id": "el-3",
                            "type": "text",
                            "x": 50, "y": 50, "width": 500, "height": 100,
                            "content": "Slide two"
                        }
                    ]
                }
            ]
        })
        .to_string()
    }

    // ---- Schema tests ----

    #[test]
    fn test_schema_creation() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();

        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        assert!(tables.contains(&"_meta".to_string()));
        assert!(tables.contains(&"presentation".to_string()));
        assert!(tables.contains(&"slides".to_string()));
        assert!(tables.contains(&"elements".to_string()));
        assert!(tables.contains(&"slide_elements".to_string()));
        assert!(tables.contains(&"assets".to_string()));

        let version: String = conn
            .query_row(
                "SELECT value FROM _meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "3");
    }

    #[test]
    fn test_asset_cache_table_exists() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let exists: bool = conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_cache'")
            .unwrap()
            .exists([])
            .unwrap();
        assert!(exists, "asset_cache table should exist at schema v3");
    }

    #[test]
    fn test_asset_cache_put_get_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let mut db = DB.lock().unwrap();
        *db = Some(conn);
        drop(db);
        let png = vec![0x89u8, 0x50, 0x4E, 0x47, 1, 2, 3, 4];
        db_put_asset_cache("a/b.svg".into(), "_".into(), 256, 128, png.clone(), Some("hash1".into())).unwrap();
        let got = db_get_asset_cache("a/b.svg".into(), "_".into(), 256, 128).unwrap().unwrap();
        assert_eq!(got.png, png);
        assert_eq!(got.source_hash.as_deref(), Some("hash1"));
        // Same source, different size — separate row.
        let png2 = vec![0u8; 16];
        db_put_asset_cache("a/b.svg".into(), "_".into(), 1920, 1080, png2.clone(), None).unwrap();
        let variants = db_list_asset_cache_variants("a/b.svg".into()).unwrap();
        assert_eq!(variants.len(), 2);
        // Clear by source removes both.
        let n = db_clear_asset_cache("a/b.svg".into()).unwrap();
        assert_eq!(n, 2);
        assert!(db_get_asset_cache("a/b.svg".into(), "_".into(), 256, 128).unwrap().is_none());
    }

    #[test]
    fn test_schema_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        create_schema(&conn).unwrap();
    }

    #[test]
    fn test_schema_indexes_exist() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();

        let indexes: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        for idx in &[
            "idx_el_current",
            "idx_el_id",
            "idx_se_slide",
            "idx_se_element",
            "idx_slides_current",
            "idx_el_link",
        ] {
            assert!(
                indexes.contains(&idx.to_string()),
                "missing index: {}",
                idx
            );
        }
    }

    // ---- Timestamp tests ----

    #[test]
    fn test_timestamp_unique_and_ordered() {
        let t1 = timestamp();
        let t2 = timestamp();
        let t3 = timestamp();
        assert_ne!(t1, t2);
        assert_ne!(t2, t3);
        assert!(t1 < t2);
        assert!(t2 < t3);
    }

    // ---- Import / Export round-trip ----

    #[test]
    fn test_import_export_roundtrip() {
        setup_global_db();

        db_import_json(sample_presentation()).unwrap();

        let output_str = db_export_json().unwrap();
        let output: Value = serde_json::from_str(&output_str).unwrap();

        assert_eq!(output["title"], "Test Presentation");
        assert_eq!(output["theme"], "dark");
        assert_eq!(output["config"]["aspectRatio"], "16:9");

        let slides = output["slides"].as_array().unwrap();
        assert_eq!(slides.len(), 2);

        assert_eq!(slides[0]["id"], "slide-1");
        // 'layout' is ignored on import (dropped in v2); it should NOT appear on output
        assert!(slides[0].get("layout").is_none() || slides[0]["layout"].is_null());
        assert_eq!(slides[0]["notes"], "Speaker notes here");
        let els = slides[0]["elements"].as_array().unwrap();
        assert_eq!(els.len(), 2);
        assert_eq!(els[0]["id"], "el-1");
        assert_eq!(els[0]["type"], "text");
        assert_eq!(els[0]["content"], "Hello world");
        assert_eq!(els[1]["id"], "el-2");
        assert_eq!(els[1]["type"], "image");

        assert_eq!(slides[1]["id"], "slide-2");
        assert_eq!(slides[1]["groupId"], "group-A");
        assert_eq!(slides[1]["layout"], "centered");
        let els2 = slides[1]["elements"].as_array().unwrap();
        assert_eq!(els2.len(), 1);
        assert_eq!(els2[0]["id"], "el-3");

        teardown_global_db();
    }

    // ---- Get slides ----

    #[test]
    fn test_get_slides() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();

        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0]["id"], "slide-1");
        assert_eq!(slides[0]["position"], 0);
        assert_eq!(slides[1]["id"], "slide-2");
        assert_eq!(slides[1]["position"], 1);
        assert_eq!(slides[1]["groupId"], "group-A");

        teardown_global_db();
    }

    // ---- Get slide elements ----

    #[test]
    fn test_get_slide_elements() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els.len(), 2);
        assert_eq!(els[0]["id"], "el-1");
        assert_eq!(els[1]["id"], "el-2");

        let els2: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-2".to_string()).unwrap()).unwrap();
        assert_eq!(els2.len(), 1);
        assert_eq!(els2[0]["id"], "el-3");

        // Non-existent slide returns empty
        let empty: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("no-such-slide".to_string()).unwrap())
                .unwrap();
        assert_eq!(empty.len(), 0);

        teardown_global_db();
    }

    // ---- Sync dedup ----

    #[test]
    fn test_sync_dedup() {
        setup_global_db();

        let input = json!({
            "title": "Sync Test",
            "slides": [
                {
                    "id": "s1",
                    "elements": [
                        { "id": "shared-1", "type": "text", "syncId": "sync-abc",
                          "x": 10, "y": 20, "content": "shared text" }
                    ]
                },
                {
                    "id": "s2",
                    "elements": [
                        { "id": "shared-1-copy", "type": "text", "syncId": "sync-abc",
                          "x": 10, "y": 20, "content": "shared text" }
                    ]
                }
            ]
        })
        .to_string();

        db_import_json(input).unwrap();

        // One element row, two junction rows
        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let el_count: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM elements WHERE valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(el_count, 1, "synced elements should produce one element row");

        let se_count: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM slide_elements WHERE valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(se_count, 2, "synced element should appear on both slides");
        drop(conn);

        // Export should mark both with syncId
        let output: Value =
            serde_json::from_str(&db_export_json().unwrap()).unwrap();
        let s1_els = output["slides"][0]["elements"].as_array().unwrap();
        let s2_els = output["slides"][1]["elements"].as_array().unwrap();
        assert!(s1_els[0].get("syncId").is_some());
        assert!(s2_els[0].get("syncId").is_some());

        teardown_global_db();
    }

    // ---- Update element ----

    #[test]
    fn test_update_element() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let new_data = json!({
            "id": "el-1", "type": "text",
            "x": 100, "y": 50, "width": 400, "height": 80,
            "content": "Updated content"
        })
        .to_string();
        db_update_element("el-1".to_string(), new_data, None).unwrap();

        // Current version has new content
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        let el1 = els.iter().find(|e| e["id"] == "el-1").unwrap();
        assert_eq!(el1["content"], "Updated content");

        // Two total versions (original + updated)
        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let total: i32 = c
            .query_row("SELECT COUNT(*) FROM elements WHERE id = 'el-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 2);

        let closed: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM elements WHERE id = 'el-1' AND valid_to IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(closed, 1);

        drop(conn);
        teardown_global_db();
    }

    #[test]
    fn test_update_preserves_type() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let data = json!({ "id": "el-2", "src": "new.png" }).to_string();
        db_update_element("el-2".to_string(), data, None).unwrap();

        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let el_type: String = c
            .query_row(
                "SELECT type FROM elements WHERE id = 'el-2' AND valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(el_type, "image");

        drop(conn);
        teardown_global_db();
    }

    // ---- Add element ----

    #[test]
    fn test_add_element() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let data = json!({ "id": "el-new", "type": "arrow", "x1": 0, "y1": 0 }).to_string();
        db_add_element(
            "slide-1".to_string(),
            "el-new".to_string(),
            "arrow".to_string(),
            data,
            None,
            5,
        )
        .unwrap();

        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els.len(), 3);
        assert!(els.iter().any(|e| e["id"] == "el-new"));

        teardown_global_db();
    }

    #[test]
    fn test_add_element_with_link_id() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        let data = json!({ "id": "el-linked", "type": "text", "content": "linked" }).to_string();
        db_add_element(
            "slide-1".to_string(),
            "el-linked".to_string(),
            "text".to_string(),
            data,
            Some("link-xyz".to_string()),
            10,
        )
        .unwrap();

        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        let linked = els.iter().find(|e| e["id"] == "el-linked").unwrap();
        assert_eq!(linked["linkId"], "link-xyz");

        teardown_global_db();
    }

    // ---- Remove element from slide ----

    #[test]
    fn test_remove_element_from_slide() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        db_remove_element_from_slide("slide-1".to_string(), "el-2".to_string()).unwrap();

        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els.len(), 1);
        assert_eq!(els[0]["id"], "el-1");

        // Element row still exists
        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let exists: bool = c
            .query_row(
                "SELECT COUNT(*) > 0 FROM elements WHERE id = 'el-2' AND valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists);

        drop(conn);
        teardown_global_db();
    }

    // ---- Temporal versioning ----

    #[test]
    fn test_temporal_versioning_multiple_updates() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        for i in 1..=3 {
            let data = json!({
                "id": "el-1", "type": "text",
                "content": format!("Version {}", i)
            })
            .to_string();
            db_update_element("el-1".to_string(), data, None).unwrap();
        }

        // Current version is the last
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        let el1 = els.iter().find(|e| e["id"] == "el-1").unwrap();
        assert_eq!(el1["content"], "Version 3");

        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        // 1 original + 3 updates = 4 total, 1 current, 3 closed
        let total: i32 = c
            .query_row("SELECT COUNT(*) FROM elements WHERE id = 'el-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 4);
        let current: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM elements WHERE id = 'el-1' AND valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current, 1);

        drop(conn);
        teardown_global_db();
    }

    // ---- Compact ----

    #[test]
    fn test_compact_deletes_history() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        for i in 1..=3 {
            let data = json!({ "id": "el-1", "type": "text", "content": format!("v{}", i) }).to_string();
            db_update_element("el-1".to_string(), data, None).unwrap();
        }

        // History exists
        {
            let conn = DB.lock().unwrap();
            let c = conn.as_ref().unwrap();
            let closed: i32 = c
                .query_row(
                    "SELECT COUNT(*) FROM elements WHERE valid_to IS NOT NULL",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(closed > 0);
        }

        db_compact(true).unwrap();

        // All closed versions gone, current remain
        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let closed: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM elements WHERE valid_to IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(closed, 0);

        let current: i32 = c
            .query_row(
                "SELECT COUNT(*) FROM elements WHERE valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(current > 0);

        drop(conn);
        teardown_global_db();
    }

    // ---- Edge cases ----

    #[test]
    fn test_empty_presentation() {
        setup_global_db();

        let input = json!({ "title": "Empty", "slides": [] }).to_string();
        db_import_json(input).unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides.len(), 0);

        let output: Value =
            serde_json::from_str(&db_export_json().unwrap()).unwrap();
        assert_eq!(output["title"], "Empty");
        assert_eq!(output["slides"].as_array().unwrap().len(), 0);

        teardown_global_db();
    }

    #[test]
    fn test_element_on_multiple_slides() {
        setup_global_db();

        let input = json!({
            "title": "Multi-slide",
            "slides": [
                { "id": "s1", "elements": [] },
                { "id": "s2", "elements": [] }
            ]
        })
        .to_string();
        db_import_json(input).unwrap();

        // Add element to slide 1
        let data = json!({ "id": "shared", "type": "text", "content": "on both" }).to_string();
        db_add_element("s1".to_string(), "shared".to_string(), "text".to_string(), data, None, 0).unwrap();

        // Add junction for slide 2
        {
            let conn = DB.lock().unwrap();
            let c = conn.as_ref().unwrap();
            let ts = timestamp();
            c.execute(
                "INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
                params!["s2", "shared", 0, &ts],
            )
            .unwrap();
        }

        let els1: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s1".to_string()).unwrap()).unwrap();
        let els2: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s2".to_string()).unwrap()).unwrap();
        assert_eq!(els1.len(), 1);
        assert_eq!(els2.len(), 1);

        // Remove from s1, should remain on s2
        db_remove_element_from_slide("s1".to_string(), "shared".to_string()).unwrap();
        let els1_after: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s1".to_string()).unwrap()).unwrap();
        let els2_after: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s2".to_string()).unwrap()).unwrap();
        assert_eq!(els1_after.len(), 0);
        assert_eq!(els2_after.len(), 1);

        teardown_global_db();
    }

    #[test]
    fn test_import_clears_previous_data() {
        setup_global_db();

        db_import_json(sample_presentation()).unwrap();
        let slides1: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides1.len(), 2);

        let input2 = json!({
            "title": "New",
            "slides": [{ "id": "only-slide", "elements": [] }]
        })
        .to_string();
        db_import_json(input2).unwrap();

        let slides2: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides2.len(), 1);
        assert_eq!(slides2[0]["id"], "only-slide");

        teardown_global_db();
    }

    #[test]
    fn test_import_strips_sync_link_fields_from_data() {
        setup_global_db();

        let input = json!({
            "title": "Strip test",
            "slides": [{
                "id": "s1",
                "elements": [{
                    "id": "e1", "type": "text",
                    "syncId": "sync-1", "linkId": "link-1",
                    "_syncId": "old", "_linkId": "old",
                    "content": "test"
                }]
            }]
        })
        .to_string();
        db_import_json(input).unwrap();

        let conn = DB.lock().unwrap();
        let c = conn.as_ref().unwrap();
        let data: String = c
            .query_row(
                "SELECT data FROM elements WHERE id = 'e1' AND valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let parsed: Value = serde_json::from_str(&data).unwrap();
        assert!(parsed.get("syncId").is_none());
        assert!(parsed.get("linkId").is_none());
        assert!(parsed.get("_syncId").is_none());
        assert!(parsed.get("_linkId").is_none());
        assert_eq!(parsed["content"], "test");

        let link_id: Option<String> = c
            .query_row(
                "SELECT link_id FROM elements WHERE id = 'e1' AND valid_to IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(link_id, Some("link-1".to_string()));

        drop(conn);
        teardown_global_db();
    }

    #[test]
    fn test_export_defaults() {
        setup_global_db();

        let input = json!({ "slides": [] }).to_string();
        db_import_json(input).unwrap();

        let output: Value =
            serde_json::from_str(&db_export_json().unwrap()).unwrap();
        assert_eq!(output["title"], "Untitled");
        assert_eq!(output["theme"], "white");

        teardown_global_db();
    }

    // ---- Slide operations ----

    #[test]
    fn test_add_slide() {
        setup_global_db();
        db_import_json(json!({ "slides": [] }).to_string()).unwrap();

        db_add_slide("new-s".to_string(), 0, Some("g1".to_string())).unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides.len(), 1);
        assert_eq!(slides[0]["id"], "new-s");
        assert_eq!(slides[0]["layout"], "centered");
        assert_eq!(slides[0]["groupId"], "g1");

        teardown_global_db();
    }

    #[test]
    fn test_delete_slide() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        db_delete_slide("slide-1".to_string()).unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides.len(), 1);
        assert_eq!(slides[0]["id"], "slide-2");

        // Slide-1 element junctions should also be closed
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els.len(), 0);

        teardown_global_db();
    }

    #[test]
    fn test_duplicate_slide() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        db_duplicate_slide(
            "slide-1".to_string(),
            "slide-1-copy".to_string(),
            2,
            None,
        )
        .unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        assert_eq!(slides.len(), 3);

        // Duplicated slide should have same elements as source
        let src_els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        let dup_els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1-copy".to_string()).unwrap())
                .unwrap();
        assert_eq!(src_els.len(), dup_els.len());

        teardown_global_db();
    }

    #[test]
    fn test_move_slide() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        db_move_slide("slide-1".to_string(), 5).unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        // slide-2 (pos 1) should come first, then slide-1 (pos 5)
        assert_eq!(slides[0]["id"], "slide-2");
        assert_eq!(slides[1]["id"], "slide-1");
        assert_eq!(slides[1]["position"], 5);

        teardown_global_db();
    }

    #[test]
    fn test_update_slide_metadata() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        db_update_slide(
            "slide-1".to_string(),
            None, // position
            Some("Updated notes".to_string()),
            None, // group_id
            Some(r#"{"theme":"dark","bodyFont":"shantell"}"#.to_string()), // config
        )
        .unwrap();

        let slides: Vec<Value> =
            serde_json::from_str(&db_get_slides().unwrap()).unwrap();
        let s1 = slides.iter().find(|s| s["id"] == "slide-1").unwrap();
        assert_eq!(s1["notes"], "Updated notes");
        // Per-slide config round-trips:
        assert_eq!(s1["theme"], "dark");
        assert_eq!(s1["bodyFont"], "shantell");

        teardown_global_db();
    }

    #[test]
    fn test_update_z_order() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        // el-1 is z=0, el-2 is z=1; move el-1 to z=10
        db_update_z_order("slide-1".to_string(), "el-1".to_string(), 10).unwrap();

        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        // el-2 (z=1) should come before el-1 (z=10)
        assert_eq!(els[0]["id"], "el-2");
        assert_eq!(els[1]["id"], "el-1");

        teardown_global_db();
    }

    #[test]
    fn test_z_order_round_trip() {
        setup_global_db();
        db_import_json(sample_presentation()).unwrap();

        // Initial order: el-1 (z=0), el-2 (z=1)
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els[0]["id"], "el-1");
        assert_eq!(els[1]["id"], "el-2");

        // Reverse the order: el-2 first, el-1 second
        db_update_z_order("slide-1".to_string(), "el-1".to_string(), 5).unwrap();
        db_update_z_order("slide-1".to_string(), "el-2".to_string(), 0).unwrap();

        // Verify via get_slide_elements
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els[0]["id"], "el-2", "el-2 should be first (z=0)");
        assert_eq!(els[1]["id"], "el-1", "el-1 should be second (z=5)");

        // Round-trip: export to JSON and verify order is preserved
        let json = db_export_json().unwrap();
        let presentation: Value = serde_json::from_str(&json).unwrap();
        let slide1 = &presentation["slides"][0];
        let elements = slide1["elements"].as_array().unwrap();
        assert_eq!(elements[0]["id"], "el-2", "export should preserve z-order: el-2 first");
        assert_eq!(elements[1]["id"], "el-1", "export should preserve z-order: el-1 second");

        // Re-import and verify order survives full round-trip
        db_import_json(json).unwrap();
        let els: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("slide-1".to_string()).unwrap()).unwrap();
        assert_eq!(els[0]["id"], "el-2", "re-import should preserve z-order: el-2 first");
        assert_eq!(els[1]["id"], "el-1", "re-import should preserve z-order: el-1 second");

        teardown_global_db();
    }

    #[test]
    fn test_free_element() {
        setup_global_db();

        // Create synced element on two slides
        let input = json!({
            "slides": [
                { "id": "s1", "elements": [
                    { "id": "shared", "type": "text", "syncId": "sy", "content": "orig" }
                ]},
                { "id": "s2", "elements": [
                    { "id": "shared-copy", "type": "text", "syncId": "sy", "content": "orig" }
                ]}
            ]
        })
        .to_string();
        db_import_json(input).unwrap();

        // Free element on s1 (give it a new independent copy)
        db_free_element(
            "s1".to_string(),
            "shared".to_string(),
            "freed-el".to_string(),
            None,
        )
        .unwrap();

        // s1 should still have exactly 1 element (the freed copy)
        let els1: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s1".to_string()).unwrap()).unwrap();
        assert_eq!(els1.len(), 1);
        // The data is copied from original, so content matches
        assert_eq!(els1[0]["content"], "orig");

        // Verify the DB-level element id is "freed-el" (not in data JSON, but in elements table)
        {
            let conn = DB.lock().unwrap();
            let c = conn.as_ref().unwrap();
            let freed_exists: bool = c
                .query_row(
                    "SELECT COUNT(*) > 0 FROM elements WHERE id = 'freed-el' AND valid_to IS NULL",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(freed_exists, "freed element should exist with new id");
            // Junction should point to freed-el on s1
            let junction_el: String = c
                .query_row(
                    "SELECT element_id FROM slide_elements WHERE slide_id = 's1' AND valid_to IS NULL",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(junction_el, "freed-el");
        }

        // s2 still has the original
        let els2: Vec<Value> =
            serde_json::from_str(&db_get_slide_elements("s2".to_string()).unwrap()).unwrap();
        assert_eq!(els2.len(), 1);
        assert_eq!(els2[0]["content"], "orig");

        teardown_global_db();
    }

    #[test]
    fn test_store_and_get_asset() {
        setup_global_db();

        let data = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic bytes
        let asset_id = db_store_asset(
            "img/test.png".to_string(), data.clone(), "image/png".to_string(),
            None, None, None, None,
        ).unwrap();
        assert!(!asset_id.is_empty(), "should return a generated asset_id");

        let retrieved = db_get_asset("img/test.png".to_string()).unwrap();
        assert_eq!(retrieved, data);

        // Dedup: identical content + same asset_id should NOT create a new version.
        let asset_id_2 = db_store_asset(
            "img/test.png".to_string(), data.clone(), "image/png".to_string(),
            None, None, Some(asset_id.clone()), None,
        ).unwrap();
        assert_eq!(asset_id, asset_id_2);
        let history = db_get_asset_history(asset_id.clone()).unwrap();
        assert_eq!(history.len(), 1, "no-op write shouldn't create a version");

        // Real change: new bytes for same asset_id -> close-old + insert-new.
        let new_data = vec![0x89, 0x50, 0x4E, 0x47, 0x0D];
        db_store_asset(
            "img/test.png".to_string(), new_data.clone(), "image/png".to_string(),
            None, None, Some(asset_id.clone()), None,
        ).unwrap();
        let history = db_get_asset_history(asset_id.clone()).unwrap();
        assert_eq!(history.len(), 2, "real change should append a version");
        assert!(history[0].valid_to.is_none(), "newest version is current");
        assert!(history[1].valid_to.is_some(), "older version is closed");

        // Restore: bring the older version back as current.
        let older_valid_from = history[1].valid_from.clone();
        db_restore_asset_version(asset_id.clone(), older_valid_from).unwrap();
        let restored = db_get_asset_by_id(asset_id.clone()).unwrap();
        assert_eq!(restored, data, "restore should bring back original bytes");

        teardown_global_db();
    }

    #[test]
    fn test_update_presentation_metadata() {
        setup_global_db();
        db_import_json(json!({ "title": "Old", "slides": [] }).to_string()).unwrap();

        db_update_presentation("title".to_string(), "New Title".to_string()).unwrap();

        let output: Value =
            serde_json::from_str(&db_export_json().unwrap()).unwrap();
        assert_eq!(output["title"], "New Title");

        teardown_global_db();
    }
}
