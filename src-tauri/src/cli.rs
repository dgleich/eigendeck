//! Eigendeck CLI — command-line tool for working with .eigendeck files.
//!
//! Usage: eigendeck-cli <file.eigendeck> <verb> [args...]
//!
//! Verbs:
//!   list slides              List all slides with element counts
//!   list elements <slide>    List elements on a slide
//!   show slide <N>           Show slide details
//!   show element <id>        Show element details
//!   add slide [--after N]    Add a blank slide
//!   add text <slide> <text>  Add a text element
//!   insert slide <N>         Insert a blank slide at position N
//!   remove slide <N>         Remove a slide
//!   remove element <id>      Remove an element from its slide
//!   move slide <from> <to>   Move a slide to a new position
//!   move element <id> <x> <y>  Move an element to a new position
//!   edit element <id> <json> Update an element's data
//!   get-text <id>            Print the text content of an element
//!   set-text <id> <text>     Set the text content of an element
//!   render <output.html>     Export to standalone HTML
//!   export json [output.json] Export current state as presentation.json
//!   validate                 Check for broken refs, orphan links, sync issues
//!   outline                  Print a text outline of the presentation
//!   search <query>           Search element text content
//!   history [--limit N]      Show edit history
//!   compact [--all]          Delete old history and shrink DB
//!   info                     Show presentation stats
//!   unpack [--demos] [--images] [--output dir]  Extract assets to disk

use rusqlite::{params, Connection};
use serde_json::Value;
use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        print_usage();
        process::exit(1);
    }

    let db_path = &args[1];
    let verb = &args[2];

    // Open the database
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error opening {}: {}", db_path, e);
            process::exit(1);
        }
    };

    let result = match verb.as_str() {
        "info" => cmd_info(&conn),
        "list" => cmd_list(&conn, &args[3..]),
        "show" => cmd_show(&conn, &args[3..]),
        "outline" => cmd_outline(&conn),
        "search" => cmd_search(&conn, &args[3..]),
        "validate" => cmd_validate(&conn),
        "history" => cmd_history(&conn, &args[3..]),
        "get-text" => cmd_get_text(&conn, &args[3..]),
        "set-text" => cmd_set_text(&conn, &args[3..]),
        "add" => cmd_add(&conn, &args[3..]),
        "insert" => cmd_insert(&conn, &args[3..]),
        "remove" => cmd_remove(&conn, &args[3..]),
        "move" => cmd_move(&conn, &args[3..]),
        "edit" => cmd_edit(&conn, &args[3..]),
        "export" => cmd_export(&conn, &args[3..]),
        "compact" => cmd_compact(&conn, &args[3..]),
        "unpack" => cmd_unpack(&conn, db_path, &args[3..]),
        _ => {
            eprintln!("Unknown verb: {}", verb);
            print_usage();
            process::exit(1);
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

fn print_usage() {
    eprintln!(
        "Usage: eigendeck-cli <file.eigendeck> <verb> [args...]

Verbs:
  info                          Show presentation stats
  list slides                   List all slides
  list elements <slide_num>     List elements on a slide (1-based)
  show slide <N>                Show slide details
  show element <id>             Show element details (full JSON)
  outline                       Print text outline of all slides
  search <query>                Search element text content
  validate                      Check for issues
  history [--limit N]           Show edit history
  get-text <element_id>         Print element text (HTML stripped)
  set-text <element_id> <text>  Set element HTML content
  add slide [--after N]         Add a blank slide
  add text <slide_num> <text>   Add a text element to a slide
  insert slide <N>              Insert blank slide at position N
  remove slide <N>              Remove slide at position N
  remove element <id> [slide_num]  Remove element from slide
  move slide <from> <to>        Reorder a slide
  move element <id> <x> <y>     Move element to position
  edit element <id> <json>      Update element data (full JSON)
  export json [output.json]     Export as presentation.json
  export html <output.html>     Export as standalone HTML (no math pre-render)
  compact [--all]               Delete history, shrink DB
  unpack [--demos] [--images] [--output dir]  Extract assets"
    );
}

// ============================================================================
// Helpers
// ============================================================================

fn get_slides(conn: &Connection) -> Vec<(String, i32, String, String, Option<String>)> {
    let mut stmt = conn
        .prepare("SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position")
        .unwrap();
    stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i32>(1)?,
            row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "default".to_string()),
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<String>>(4)?,
        ))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn get_slide_elements(conn: &Connection, slide_id: &str) -> Vec<Value> {
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.type, e.data, e.link_id, se.z_order
             FROM slide_elements se
             JOIN elements e ON e.id = se.element_id AND e.valid_to IS NULL
             WHERE se.slide_id = ?1 AND se.valid_to IS NULL
             ORDER BY se.z_order",
        )
        .unwrap();
    stmt.query_map(params![slide_id], |row| {
        let mut data: Value = serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(Value::Null);
        if let Some(obj) = data.as_object_mut() {
            if let Some(link_id) = row.get::<_, Option<String>>(3)? {
                obj.insert("linkId".to_string(), Value::String(link_id));
            }
        }
        Ok(data)
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn strip_html(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; }
        else if !in_tag { result.push(c); }
    }
    result.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
}

fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}.{:03}Z-{:08}", d.as_secs(), d.subsec_millis(), seq)
}

fn slide_id_by_position(conn: &Connection, pos: i32) -> Option<String> {
    conn.query_row(
        "SELECT id FROM slides WHERE position = ?1 AND valid_to IS NULL",
        params![pos - 1], // 1-based to 0-based
        |row| row.get(0),
    )
    .ok()
}

// ============================================================================
// Commands
// ============================================================================

fn cmd_info(conn: &Connection) -> Result<(), String> {
    let title: String = conn
        .query_row("SELECT value FROM presentation WHERE key = 'title'", [], |r| r.get(0))
        .unwrap_or_else(|_| "Untitled".to_string());
    let config: String = conn
        .query_row("SELECT value FROM presentation WHERE key = 'config'", [], |r| r.get(0))
        .unwrap_or_else(|_| "{}".to_string());

    let slides = get_slides(conn);
    let el_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM elements WHERE valid_to IS NULL", [], |r| r.get(0))
        .unwrap_or(0);
    let se_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM slide_elements WHERE valid_to IS NULL", [], |r| r.get(0))
        .unwrap_or(0);
    let total_versions: i32 = conn
        .query_row("SELECT COUNT(*) FROM elements", [], |r| r.get(0))
        .unwrap_or(0);
    let asset_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
        .unwrap_or(0);

    let synced = se_count - el_count;

    println!("{}", title);
    println!("  Slides: {}", slides.len());
    println!("  Elements: {} ({} placements, {} synced)", el_count, se_count, synced.max(0));
    println!("  Versions: {} total", total_versions);
    println!("  Assets: {}", asset_count);

    let config_val: Value = serde_json::from_str(&config).unwrap_or(Value::Null);
    if let Some(author) = config_val.get("author").and_then(|v| v.as_str()) {
        if !author.is_empty() { println!("  Author: {}", author); }
    }
    if let Some(venue) = config_val.get("venue").and_then(|v| v.as_str()) {
        if !venue.is_empty() { println!("  Venue: {}", venue); }
    }

    Ok(())
}

fn cmd_list(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).unwrap_or("slides");
    match what {
        "slides" => {
            let slides = get_slides(conn);
            for (id, pos, layout, notes, group_id) in &slides {
                let el_count: i32 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM slide_elements WHERE slide_id = ?1 AND valid_to IS NULL",
                        params![id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let group = group_id.as_deref().map(|g| format!(" [group {}]", &g[..8.min(g.len())])).unwrap_or_default();
                let note_preview = if notes.is_empty() { String::new() } else { format!(" \"{}\"", &notes[..60.min(notes.len())]) };
                println!("  {:>3}. {} {:>2} els  {}{}{}",
                    pos + 1, &id[..8.min(id.len())], el_count, layout, group, note_preview);
            }
        }
        "elements" => {
            let slide_num: i32 = args.get(1)
                .and_then(|s| s.parse().ok())
                .ok_or("Usage: list elements <slide_num>")?;
            let slide_id = slide_id_by_position(conn, slide_num)
                .ok_or_else(|| format!("Slide {} not found", slide_num))?;
            let elements = get_slide_elements(conn, &slide_id);
            for (i, el) in elements.iter().enumerate() {
                let id = el.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let el_type = el.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                let preset = el.get("preset").and_then(|v| v.as_str());
                let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let text = strip_html(html);
                let preview = if text.len() > 50 { format!("{}...", &text[..50]) } else { text.clone() };
                let preset_str = preset.map(|p| format!(" ({})", p)).unwrap_or_default();
                println!("  {:>2}. {} {}{} \"{}\"", i, &id[..8.min(id.len())], el_type, preset_str, preview);
            }
        }
        _ => return Err(format!("Unknown: list {}", what)),
    }
    Ok(())
}

fn cmd_show(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: show <slide|element> <id>")?;
    match what {
        "slide" => {
            let num: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: show slide <N>")?;
            let slide_id = slide_id_by_position(conn, num).ok_or("Slide not found")?;
            let elements = get_slide_elements(conn, &slide_id);
            println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                "id": slide_id,
                "elements": elements,
            })).unwrap());
        }
        "element" => {
            let id = args.get(1).ok_or("Usage: show element <id>")?;
            // Partial ID match
            let full_id: String = conn
                .query_row(
                    "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
                    params![format!("{}%", id)],
                    |r| r.get(0),
                )
                .map_err(|_| format!("Element {} not found", id))?;
            let data: String = conn
                .query_row(
                    "SELECT data FROM elements WHERE id = ?1 AND valid_to IS NULL",
                    params![&full_id],
                    |r| r.get(0),
                )
                .map_err(|_| "Element not found".to_string())?;
            let parsed: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
            println!("{}", serde_json::to_string_pretty(&parsed).unwrap());
        }
        _ => return Err(format!("Unknown: show {}", what)),
    }
    Ok(())
}

fn cmd_outline(conn: &Connection) -> Result<(), String> {
    let slides = get_slides(conn);
    for (id, pos, _layout, notes, group_id) in &slides {
        let group = group_id.as_deref().map(|_| " [build]").unwrap_or("");
        println!("Slide {}{}:", pos + 1, group);
        let elements = get_slide_elements(conn, id);
        for el in &elements {
            let el_type = el.get("type").and_then(|v| v.as_str()).unwrap_or("?");
            if el_type == "text" {
                let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let text = strip_html(html);
                let preset = el.get("preset").and_then(|v| v.as_str()).unwrap_or("text");
                if !text.trim().is_empty() {
                    let indent = if preset == "title" { "  " } else { "    " };
                    let weight = if preset == "title" { "# " } else if preset == "body" { "- " } else { "  " };
                    // Wrap long lines
                    for line in text.split('\n') {
                        if !line.trim().is_empty() {
                            println!("{}{}{}", indent, weight, line.trim());
                        }
                    }
                }
            } else if el_type == "image" {
                let src = el.get("src").and_then(|v| v.as_str()).unwrap_or("?");
                println!("    [image: {}]", src);
            } else if el_type == "demo" || el_type == "demo-piece" {
                let src = el.get("src").or_else(|| el.get("demoSrc")).and_then(|v| v.as_str()).unwrap_or("?");
                println!("    [demo: {}]", src);
            }
        }
        if !notes.is_empty() {
            println!("    Notes: {}", &notes[..80.min(notes.len())]);
        }
        println!();
    }
    Ok(())
}

fn cmd_search(conn: &Connection, args: &[String]) -> Result<(), String> {
    let query = args.join(" ");
    if query.is_empty() { return Err("Usage: search <query>".to_string()); }
    let query_lower = query.to_lowercase();

    let slides = get_slides(conn);
    let mut found = 0;
    for (id, pos, _, _, _) in &slides {
        let elements = get_slide_elements(conn, id);
        for el in &elements {
            let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
            let text = strip_html(html);
            if text.to_lowercase().contains(&query_lower) {
                let el_id = el.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let preset = el.get("preset").and_then(|v| v.as_str()).unwrap_or("text");
                // Highlight match context
                let lower = text.to_lowercase();
                if let Some(idx) = lower.find(&query_lower) {
                    let start = idx.saturating_sub(20);
                    let end = (idx + query.len() + 20).min(text.len());
                    let context = &text[start..end];
                    println!("  Slide {}, {} ({}): ...{}...", pos + 1, &el_id[..8.min(el_id.len())], preset, context);
                    found += 1;
                }
            }
        }
    }
    if found == 0 { println!("No results for \"{}\"", query); }
    else { println!("\n{} match(es)", found); }
    Ok(())
}

fn cmd_validate(conn: &Connection) -> Result<(), String> {
    let mut errors = 0;
    let mut warnings = 0;

    // Orphan linkIds
    let mut stmt = conn.prepare(
        "SELECT link_id, COUNT(*) as n FROM elements WHERE valid_to IS NULL AND link_id IS NOT NULL GROUP BY link_id HAVING n = 1"
    ).unwrap();
    for row in stmt.query_map([], |r| Ok(r.get::<_, String>(0)?)).unwrap() {
        if let Ok(lid) = row {
            println!("  WARN: orphan linkId {}", &lid[..8.min(lid.len())]);
            warnings += 1;
        }
    }

    // Elements on zero slides
    let orphan_els: i32 = conn.query_row(
        "SELECT COUNT(*) FROM elements e WHERE e.valid_to IS NULL AND NOT EXISTS (SELECT 1 FROM slide_elements se WHERE se.element_id = e.id AND se.valid_to IS NULL)",
        [], |r| r.get(0)
    ).unwrap_or(0);
    if orphan_els > 0 {
        println!("  WARN: {} elements not on any slide", orphan_els);
        warnings += orphan_els as usize;
    }

    // Duplicate element IDs (shouldn't happen with temporal model)
    let dupes: i32 = conn.query_row(
        "SELECT COUNT(*) FROM (SELECT id, COUNT(*) as n FROM elements WHERE valid_to IS NULL GROUP BY id HAVING n > 1)",
        [], |r| r.get(0)
    ).unwrap_or(0);
    if dupes > 0 {
        println!("  ERROR: {} duplicate element IDs in current state", dupes);
        errors += dupes as usize;
    }

    println!();
    if errors == 0 && warnings == 0 { println!("✓ No issues found"); }
    else { println!("{} error(s), {} warning(s)", errors, warnings); }

    if errors > 0 { process::exit(1); }
    Ok(())
}

fn cmd_history(conn: &Connection, args: &[String]) -> Result<(), String> {
    let limit: i32 = args.iter()
        .find(|a| a.starts_with("--limit="))
        .and_then(|a| a.split('=').nth(1)?.parse().ok())
        .unwrap_or(50);

    // Get recent element changes
    let mut stmt = conn.prepare(
        "SELECT id, type, data, valid_from, valid_to FROM elements ORDER BY valid_from DESC LIMIT ?1"
    ).unwrap();
    let rows: Vec<_> = stmt.query_map(params![limit], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    }).unwrap().filter_map(|r| r.ok()).collect();

    for (id, el_type, data, valid_from, valid_to) in rows.iter().rev() {
        let parsed: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        let html = parsed.get("html").and_then(|v| v.as_str()).unwrap_or("");
        let text = strip_html(html);
        let preview = if text.len() > 40 { format!("{}...", &text[..40]) } else { text };
        let status = if valid_to.is_none() { "current" } else { "closed " };
        let ts = &valid_from[..valid_from.len().min(23)];
        println!("  {} {} {} {} \"{}\"", ts, status, &id[..8.min(id.len())], el_type, preview);
    }
    Ok(())
}

fn cmd_get_text(conn: &Connection, args: &[String]) -> Result<(), String> {
    let id = args.first().ok_or("Usage: get-text <element_id>")?;
    let full_id: String = conn
        .query_row(
            "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
            params![format!("{}%", id)],
            |r| r.get(0),
        )
        .map_err(|_| format!("Element {} not found", id))?;
    let data: String = conn
        .query_row("SELECT data FROM elements WHERE id = ?1 AND valid_to IS NULL", params![&full_id], |r| r.get(0))
        .map_err(|_| "Not found".to_string())?;
    let parsed: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
    let html = parsed.get("html").and_then(|v| v.as_str()).unwrap_or("");
    println!("{}", strip_html(html));
    Ok(())
}

fn cmd_set_text(conn: &Connection, args: &[String]) -> Result<(), String> {
    let id = args.first().ok_or("Usage: set-text <element_id> <text>")?;
    let text = args[1..].join(" ");
    let full_id: String = conn
        .query_row(
            "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
            params![format!("{}%", id)],
            |r| r.get(0),
        )
        .map_err(|_| format!("Element {} not found", id))?;

    let (el_type, data_str, link_id): (String, String, Option<String>) = conn
        .query_row(
            "SELECT type, data, link_id FROM elements WHERE id = ?1 AND valid_to IS NULL",
            params![&full_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Not found".to_string())?;

    let mut data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);
    if let Some(obj) = data.as_object_mut() {
        obj.insert("html".to_string(), Value::String(text));
    }

    let ts = timestamp();
    conn.execute("UPDATE elements SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &full_id]).unwrap();
    conn.execute("INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![&full_id, &el_type, data.to_string(), &link_id, &ts]).unwrap();
    println!("Updated {}", &full_id[..8.min(full_id.len())]);
    Ok(())
}

fn cmd_add(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: add <slide|text> ...")?;
    match what {
        "slide" => {
            let slides = get_slides(conn);
            let after: i32 = args.iter()
                .find(|a| a.starts_with("--after="))
                .and_then(|a| a.split('=').nth(1)?.parse().ok())
                .unwrap_or(slides.len() as i32);
            let id = uuid();
            let ts = timestamp();
            conn.execute("INSERT INTO slides VALUES (?1, ?2, 'default', '', NULL, ?3, NULL)",
                params![&id, after, &ts]).unwrap();
            println!("Added slide {} at position {}", &id[..8], after + 1);
        }
        "text" => {
            let slide_num: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: add text <slide_num> <text>")?;
            let text = args[2..].join(" ");
            let slide_id = slide_id_by_position(conn, slide_num).ok_or("Slide not found")?;
            let el_id = uuid();
            let el_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM slide_elements WHERE slide_id = ?1 AND valid_to IS NULL",
                params![&slide_id], |r| r.get(0)
            ).unwrap_or(0);
            let data = serde_json::json!({
                "id": el_id,
                "type": "text",
                "preset": "body",
                "html": text,
                "position": { "x": 80, "y": 240, "width": 1760, "height": 200 }
            });
            let ts = timestamp();
            conn.execute("INSERT INTO elements VALUES (?1, 'text', ?2, NULL, ?3, NULL)",
                params![&el_id, data.to_string(), &ts]).unwrap();
            conn.execute("INSERT INTO slide_elements VALUES (?1, ?2, ?3, ?4, NULL)",
                params![&slide_id, &el_id, el_count, &ts]).unwrap();
            println!("Added text element {} to slide {}", &el_id[..8], slide_num);
        }
        _ => return Err(format!("Unknown: add {}", what)),
    }
    Ok(())
}

fn cmd_insert(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: insert slide <N>")?;
    if what != "slide" { return Err("Usage: insert slide <N>".to_string()); }
    let pos: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: insert slide <N>")?;
    let id = uuid();
    let ts = timestamp();
    conn.execute("INSERT INTO slides VALUES (?1, ?2, 'default', '', NULL, ?3, NULL)",
        params![&id, pos - 1, &ts]).unwrap();
    println!("Inserted slide {} at position {}", &id[..8], pos);
    Ok(())
}

fn cmd_remove(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: remove <slide|element> ...")?;
    let ts = timestamp();
    match what {
        "slide" => {
            let num: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: remove slide <N>")?;
            let slide_id = slide_id_by_position(conn, num).ok_or("Slide not found")?;
            conn.execute("UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &slide_id]).unwrap();
            conn.execute("UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND valid_to IS NULL", params![&ts, &slide_id]).unwrap();
            println!("Removed slide {}", num);
        }
        "element" => {
            let id = args.get(1).ok_or("Usage: remove element <id> [slide_num]")?;
            let full_id: String = conn.query_row(
                "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
                params![format!("{}%", id)], |r| r.get(0)
            ).map_err(|_| format!("Element {} not found", id))?;

            if let Some(slide_num) = args.get(2).and_then(|s| s.parse::<i32>().ok()) {
                let slide_id = slide_id_by_position(conn, slide_num).ok_or("Slide not found")?;
                conn.execute("UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND element_id = ?3 AND valid_to IS NULL",
                    params![&ts, &slide_id, &full_id]).unwrap();
                println!("Removed {} from slide {}", &full_id[..8], slide_num);
            } else {
                conn.execute("UPDATE slide_elements SET valid_to = ?1 WHERE element_id = ?2 AND valid_to IS NULL",
                    params![&ts, &full_id]).unwrap();
                println!("Removed {} from all slides", &full_id[..8]);
            }
        }
        _ => return Err(format!("Unknown: remove {}", what)),
    }
    Ok(())
}

fn cmd_move(conn: &Connection, args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: move <slide|element> ...")?;
    let ts = timestamp();
    match what {
        "slide" => {
            let from: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: move slide <from> <to>")?;
            let to: i32 = args.get(2).and_then(|s| s.parse().ok()).ok_or("Usage: move slide <from> <to>")?;
            let slide_id = slide_id_by_position(conn, from).ok_or("Slide not found")?;
            // Close old, insert new position
            let (layout, notes, group_id): (String, String, Option<String>) = conn.query_row(
                "SELECT layout, notes, group_id FROM slides WHERE id = ?1 AND valid_to IS NULL",
                params![&slide_id], |r| Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_else(|| "default".to_string()),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?,
                ))
            ).unwrap();
            conn.execute("UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &slide_id]).unwrap();
            conn.execute("INSERT INTO slides VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                params![&slide_id, to - 1, &layout, &notes, &group_id, &ts]).unwrap();
            println!("Moved slide {} to position {}", from, to);
        }
        "element" => {
            let id = args.get(1).ok_or("Usage: move element <id> <x> <y>")?;
            let x: f64 = args.get(2).and_then(|s| s.parse().ok()).ok_or("Usage: move element <id> <x> <y>")?;
            let y: f64 = args.get(3).and_then(|s| s.parse().ok()).ok_or("Usage: move element <id> <x> <y>")?;

            let full_id: String = conn.query_row(
                "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
                params![format!("{}%", id)], |r| r.get(0)
            ).map_err(|_| format!("Element {} not found", id))?;

            let (el_type, data_str, link_id): (String, String, Option<String>) = conn.query_row(
                "SELECT type, data, link_id FROM elements WHERE id = ?1 AND valid_to IS NULL",
                params![&full_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            ).unwrap();

            let mut data: Value = serde_json::from_str(&data_str).unwrap();
            if let Some(pos) = data.get_mut("position").and_then(|v| v.as_object_mut()) {
                pos.insert("x".to_string(), serde_json::json!(x));
                pos.insert("y".to_string(), serde_json::json!(y));
            }

            conn.execute("UPDATE elements SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &full_id]).unwrap();
            conn.execute("INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                params![&full_id, &el_type, data.to_string(), &link_id, &ts]).unwrap();
            println!("Moved {} to ({}, {})", &full_id[..8], x, y);
        }
        _ => return Err(format!("Unknown: move {}", what)),
    }
    Ok(())
}

fn cmd_edit(conn: &Connection, args: &[String]) -> Result<(), String> {
    if args.first().map(|s| s.as_str()) != Some("element") {
        return Err("Usage: edit element <id> <json>".to_string());
    }
    let id = args.get(1).ok_or("Usage: edit element <id> <json>")?;
    let json_str = args[2..].join(" ");
    let new_data: Value = serde_json::from_str(&json_str).map_err(|e| format!("Invalid JSON: {}", e))?;

    let full_id: String = conn.query_row(
        "SELECT id FROM elements WHERE id LIKE ?1 AND valid_to IS NULL LIMIT 1",
        params![format!("{}%", id)], |r| r.get(0)
    ).map_err(|_| format!("Element {} not found", id))?;

    let (el_type, link_id): (String, Option<String>) = conn.query_row(
        "SELECT type, link_id FROM elements WHERE id = ?1 AND valid_to IS NULL",
        params![&full_id], |r| Ok((r.get(0)?, r.get(2)?))
    ).unwrap();

    let ts = timestamp();
    conn.execute("UPDATE elements SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &full_id]).unwrap();
    conn.execute("INSERT INTO elements VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![&full_id, &el_type, new_data.to_string(), &link_id, &ts]).unwrap();
    println!("Updated {}", &full_id[..8]);
    Ok(())
}

fn cmd_export(conn: &Connection, args: &[String]) -> Result<(), String> {
    let format = args.first().map(|s| s.as_str()).ok_or("Usage: export <json|html> [output]")?;
    let output = args.get(1);

    match format {
        "json" => {
            // Reuse storage::db_export_json logic
            let json = export_json(conn)?;
            if let Some(path) = output {
                std::fs::write(path, &json).map_err(|e| e.to_string())?;
                println!("Exported to {}", path);
            } else {
                println!("{}", json);
            }
        }
        "html" => {
            let path = output.ok_or("Usage: export html <output.html>")?;
            // For now, export JSON and note that HTML export needs the Node tool
            let json = export_json(conn)?;
            std::fs::write(path.replace(".html", ".json"), &json).map_err(|e| e.to_string())?;
            println!("Exported JSON to {} (use node tools/eigendeck.mjs for full HTML export with math)", path.replace(".html", ".json"));
        }
        _ => return Err(format!("Unknown format: {}", format)),
    }
    Ok(())
}

fn export_json(conn: &Connection) -> Result<String, String> {
    // Simplified version of storage::db_export_json
    let mut title = "Untitled".to_string();
    let mut theme = "white".to_string();
    let mut config = Value::Object(serde_json::Map::new());

    let mut stmt = conn.prepare("SELECT key, value FROM presentation").unwrap();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap() {
        let (k, v) = row.unwrap();
        match k.as_str() {
            "title" => title = v,
            "theme" => theme = v,
            "config" => config = serde_json::from_str(&v).unwrap_or(config),
            _ => {}
        }
    }

    let slides = get_slides(conn);
    let mut slides_json = Vec::new();
    for (id, _pos, layout, notes, group_id) in &slides {
        let elements = get_slide_elements(conn, id);
        let mut slide = serde_json::json!({
            "id": id, "layout": layout, "elements": elements, "notes": notes,
        });
        if let Some(gid) = group_id {
            slide.as_object_mut().unwrap().insert("groupId".to_string(), Value::String(gid.clone()));
        }
        slides_json.push(slide);
    }

    let presentation = serde_json::json!({
        "title": title, "theme": theme, "slides": slides_json, "config": config,
    });
    serde_json::to_string_pretty(&presentation).map_err(|e| e.to_string())
}

fn cmd_compact(conn: &Connection, args: &[String]) -> Result<(), String> {
    let all = args.iter().any(|a| a == "--all");

    let before: i32 = conn.query_row("SELECT COUNT(*) FROM elements", [], |r| r.get(0)).unwrap_or(0);

    if all {
        conn.execute_batch(
            "DELETE FROM elements WHERE valid_to IS NOT NULL;
             DELETE FROM slide_elements WHERE valid_to IS NOT NULL;
             DELETE FROM slides WHERE valid_to IS NOT NULL;"
        ).unwrap();
    } else {
        conn.execute_batch(
            "DELETE FROM elements WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');
             DELETE FROM slide_elements WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');
             DELETE FROM slides WHERE valid_to IS NOT NULL AND valid_from < datetime('now', '-1 hour');"
        ).unwrap();
    }
    conn.execute_batch("VACUUM;").unwrap();

    let after: i32 = conn.query_row("SELECT COUNT(*) FROM elements", [], |r| r.get(0)).unwrap_or(0);
    println!("Compacted: {} → {} element versions ({} removed)", before, after, before - after);
    Ok(())
}

fn cmd_unpack(conn: &Connection, db_path: &str, args: &[String]) -> Result<(), String> {
    let demos_only = args.iter().any(|a| a == "--demos");
    let images_only = args.iter().any(|a| a == "--images");
    let output_dir = args.iter()
        .position(|a| a == "--output")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str());

    let base_dir = output_dir.unwrap_or_else(|| {
        db_path.strip_suffix(".eigendeck").unwrap_or(db_path)
    });

    // Check if directory exists
    if std::path::Path::new(base_dir).exists() && output_dir.is_none() {
        return Err(format!("Directory {} already exists. Use --output <dir> to extract elsewhere.", base_dir));
    }

    let mut stmt = conn.prepare("SELECT path, data, mime_type, size FROM assets").unwrap();
    let rows: Vec<_> = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Vec<u8>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<i64>>(3)?,
        ))
    }).unwrap().filter_map(|r| r.ok()).collect();

    let mut count = 0;
    for (path, data, _mime, _size) in &rows {
        let is_demo = path.starts_with("demos/");
        let is_image = path.starts_with("images/");

        if demos_only && !is_demo { continue; }
        if images_only && !is_image { continue; }

        let full_path = format!("{}/{}", base_dir, path);
        let dir = std::path::Path::new(&full_path).parent().unwrap();
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        std::fs::write(&full_path, data).map_err(|e| e.to_string())?;
        count += 1;
    }

    println!("Unpacked {} files to {}", count, base_dir);
    Ok(())
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let a = d.as_nanos();
    format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (a >> 96) as u32, (a >> 80) as u16 & 0xffff,
        (a >> 64) as u16 & 0xfff,
        0x8000 | ((a >> 48) as u16 & 0x3fff),
        a as u64 & 0xffffffffffff)
}
