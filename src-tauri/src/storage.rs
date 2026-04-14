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
const SCHEMA_VERSION: i32 = 1;

/// Create the schema in a new database
pub fn create_schema(conn: &Connection) -> SqlResult<()> {
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
            layout TEXT,
            notes TEXT,
            group_id TEXT,
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

        CREATE TABLE IF NOT EXISTS assets (
            path TEXT PRIMARY KEY,
            data BLOB NOT NULL,
            mime_type TEXT,
            size INTEGER,
            hash TEXT,
            created_at TEXT,
            external_path TEXT,
            external_mtime TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_el_id ON elements(id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
        ",
    )?;

    // Set schema version
    conn.execute(
        "INSERT OR REPLACE INTO _meta VALUES ('schema_version', ?1)",
        params![SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

/// Open or create a .eigendeck SQLite database
pub fn open_db(path: &str) -> SqlResult<()> {
    let conn = Connection::open(path)?;
    create_schema(&conn)?;
    let mut db = DB.lock().unwrap();
    *db = Some(conn);
    Ok(())
}

/// Close the database, checkpointing WAL for clean single file
pub fn close_db() -> SqlResult<()> {
    let mut db = DB.lock().unwrap();
    if let Some(conn) = db.take() {
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        // Connection drops and closes here
    }
    Ok(())
}

/// Generate a high-resolution timestamp for versioning
fn timestamp() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = chrono_lite_now();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{:08}", now, seq)
}

/// Simple ISO timestamp without chrono dependency
fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    // Simple UTC format (good enough for ordering)
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    // Approximate date (not perfectly accurate but fine for ordering)
    let y = 1970 + days / 365;
    let rem_days = days % 365;
    let mo = rem_days / 30 + 1;
    let d = rem_days % 30 + 1;
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

// ============================================================================
// Tauri commands
// ============================================================================

/// Open a .eigendeck file (or create if it doesn't exist)
#[tauri::command]
pub fn db_open(path: String) -> Result<(), String> {
    open_db(&path).map_err(|e| e.to_string())
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
                let layout = slide
                    .get("layout")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default");
                let notes = slide.get("notes").and_then(|v| v.as_str()).unwrap_or("");
                let group_id = slide.get("groupId").and_then(|v| v.as_str());

                tx.execute(
                    "INSERT INTO slides VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                    params![slide_id, i as i32, layout, notes, group_id, &ts],
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
            "SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position",
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
            let (id, _position, layout, notes, group_id) = row?;

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
                "layout": layout.unwrap_or_else(|| "default".to_string()),
                "elements": slide_elements,
                "notes": notes.unwrap_or_default(),
            });
            if let Some(gid) = group_id {
                slide
                    .as_object_mut()
                    .unwrap()
                    .insert("groupId".to_string(), Value::String(gid));
            }
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
            "SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "position": row.get::<_, i32>(1)?,
                "layout": row.get::<_, Option<String>>(2)?,
                "notes": row.get::<_, Option<String>>(3)?,
                "groupId": row.get::<_, Option<String>>(4)?,
            }))
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
    layout: String,
    group_id: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        conn.execute(
            "INSERT INTO slides VALUES (?1, ?2, ?3, '', ?4, ?5, NULL)",
            params![&id, position, &layout, &group_id, &ts],
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

        // Get source slide metadata
        let (layout, notes, src_group): (String, String, Option<String>) = tx.query_row(
            "SELECT layout, notes, group_id FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&source_slide_id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "default".to_string()),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?,
            )),
        )?;

        let final_group_id = group_id.or(src_group);

        // Create new slide
        tx.execute(
            "INSERT INTO slides VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![&new_slide_id, new_position, &layout, &notes, &final_group_id, &ts],
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

        // Get current slide data
        let (layout, notes, group_id): (String, String, Option<String>) = tx.query_row(
            "SELECT layout, notes, group_id FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&slide_id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "default".to_string()),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
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
            "INSERT INTO slides VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![&slide_id, new_position, &layout, &notes, &group_id, &ts],
        )?;

        tx.commit()?;
        Ok(())
    })
}

/// Update slide metadata (layout, notes, group_id)
#[tauri::command]
pub fn db_update_slide(
    slide_id: String,
    layout: Option<String>,
    notes: Option<String>,
    group_id: Option<String>,
) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Get current
        let (cur_pos, cur_layout, cur_notes, cur_group): (i32, String, String, Option<String>) = tx.query_row(
            "SELECT position, layout, notes, group_id FROM slides WHERE id = ?1 AND valid_to IS NULL",
            params![&slide_id],
            |row| Ok((
                row.get(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "default".to_string()),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?,
            )),
        )?;

        // Close old
        tx.execute(
            "UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
            params![&ts, &slide_id],
        )?;

        // Insert updated
        tx.execute(
            "INSERT INTO slides VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                &slide_id,
                cur_pos,
                layout.as_deref().unwrap_or(&cur_layout),
                notes.as_deref().unwrap_or(&cur_notes),
                group_id.or(cur_group),
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

/// Store an asset (image/demo) as a BLOB
#[tauri::command]
pub fn db_store_asset(
    path: String,
    data: Vec<u8>,
    mime_type: String,
) -> Result<(), String> {
    with_db(|conn| {
        let size = data.len() as i64;
        let now = timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO assets VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, NULL)",
            params![&path, &data, &mime_type, size, &now],
        )?;
        Ok(())
    })
}

/// Read an asset BLOB
#[tauri::command]
pub fn db_get_asset(path: String) -> Result<Vec<u8>, String> {
    with_db(|conn| {
        let data: Vec<u8> = conn.query_row(
            "SELECT data FROM assets WHERE path = ?1",
            params![&path],
            |row| row.get(0),
        )?;
        Ok(data)
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
