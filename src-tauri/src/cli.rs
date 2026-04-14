//! Eigendeck CLI — command-line tool for working with .eigendeck files.
//!
//! Uses eigendeck_lib::storage for all database operations — same code
//! as the GUI app, no duplicated SQL.
//!
//! Usage: eigendeck-cli <file.eigendeck> <verb> [args...]

use serde_json::Value;
use std::env;
use std::process;

// Use the library's storage module
use eigendeck_lib::storage;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        print_usage();
        process::exit(1);
    }

    let db_path = &args[1];
    let verb = &args[2];

    // Open the database using the library
    if let Err(e) = storage::open_db(db_path) {
        eprintln!("Error opening {}: {}", db_path, e);
        process::exit(1);
    }

    let result = match verb.as_str() {
        "info" => cmd_info(),
        "list" => cmd_list(&args[3..]),
        "show" => cmd_show(&args[3..]),
        "outline" => cmd_outline(),
        "search" => cmd_search(&args[3..]),
        "validate" => cmd_validate(),
        "history" => cmd_history(&args[3..]),
        "get-text" => cmd_get_text(&args[3..]),
        "set-text" => cmd_set_text(&args[3..]),
        "add" => cmd_add(&args[3..]),
        "insert" => cmd_insert(&args[3..]),
        "remove" => cmd_remove(&args[3..]),
        "move" => cmd_move(&args[3..]),
        "edit" => cmd_edit(&args[3..]),
        "export" => cmd_export(&args[3..]),
        "compact" => cmd_compact(&args[3..]),
        "unpack" => cmd_unpack(db_path, &args[3..]),
        _ => {
            eprintln!("Unknown verb: {}", verb);
            print_usage();
            process::exit(1);
        }
    };

    // Close DB cleanly
    let _ = storage::close_db();

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
  show element <id>             Show element details (partial ID match)
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
  remove element <id> [slide]   Remove element from slide
  move slide <from> <to>        Reorder a slide
  move element <id> <x> <y>     Move element to position
  edit element <id> <json>      Update element data (full JSON)
  export json [output.json]     Export as presentation.json
  compact [--all]               Delete history, shrink DB
  unpack [--demos] [--images]   Extract assets"
    );
}

// ============================================================================
// Helpers — use the library's storage functions via with_db
// ============================================================================

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

// ============================================================================
// Commands — all use storage:: functions from the library
// ============================================================================

fn cmd_info() -> Result<(), String> {
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    let title = p.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
    let slides = p.get("slides").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    let config = p.get("config").unwrap_or(&Value::Null);
    let author = config.get("author").and_then(|v| v.as_str()).unwrap_or("");
    let venue = config.get("venue").and_then(|v| v.as_str()).unwrap_or("");

    let mut el_count = 0;
    if let Some(sl) = p.get("slides").and_then(|v| v.as_array()) {
        for s in sl {
            el_count += s.get("elements").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        }
    }

    println!("{}", title);
    println!("  Slides: {}", slides);
    println!("  Elements: {}", el_count);
    if !author.is_empty() { println!("  Author: {}", author); }
    if !venue.is_empty() { println!("  Venue: {}", venue); }
    Ok(())
}

fn cmd_list(args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).unwrap_or("slides");
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;

    match what {
        "slides" => {
            for (i, s) in slides.iter().enumerate() {
                let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let el_count = s.get("elements").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                let layout = s.get("layout").and_then(|v| v.as_str()).unwrap_or("default");
                let group = s.get("groupId").and_then(|v| v.as_str()).map(|g| format!(" [group {}]", &g[..8.min(g.len())])).unwrap_or_default();
                println!("  {:>3}. {} {:>2} els  {}{}", i + 1, &id[..8.min(id.len())], el_count, layout, group);
            }
        }
        "elements" => {
            let num: usize = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: list elements <N>")?;
            let slide = slides.get(num - 1).ok_or("Slide not found")?;
            let elements = slide.get("elements").and_then(|v| v.as_array()).ok_or("No elements")?;
            for (i, el) in elements.iter().enumerate() {
                let id = el.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let t = el.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                let preset = el.get("preset").and_then(|v| v.as_str()).map(|p| format!(" ({})", p)).unwrap_or_default();
                let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let text = strip_html(html);
                let preview = if text.len() > 50 { format!("{}...", &text[..50]) } else { text };
                println!("  {:>2}. {} {}{} \"{}\"", i, &id[..8.min(id.len())], t, preset, preview);
            }
        }
        _ => return Err(format!("Unknown: list {}", what)),
    }
    Ok(())
}

fn cmd_show(args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: show <slide|element> <id>")?;
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    match what {
        "slide" => {
            let num: usize = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: show slide <N>")?;
            let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;
            let slide = slides.get(num - 1).ok_or("Slide not found")?;
            println!("{}", serde_json::to_string_pretty(slide).unwrap());
        }
        "element" => {
            let id_prefix = args.get(1).ok_or("Usage: show element <id>")?;
            let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;
            for s in slides {
                if let Some(els) = s.get("elements").and_then(|v| v.as_array()) {
                    for el in els {
                        let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if eid.starts_with(id_prefix.as_str()) {
                            println!("{}", serde_json::to_string_pretty(el).unwrap());
                            return Ok(());
                        }
                    }
                }
            }
            return Err(format!("Element {} not found", id_prefix));
        }
        _ => return Err(format!("Unknown: show {}", what)),
    }
    Ok(())
}

fn cmd_outline() -> Result<(), String> {
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;

    for (i, s) in slides.iter().enumerate() {
        let group = if s.get("groupId").is_some() { " [build]" } else { "" };
        println!("Slide {}{}:", i + 1, group);
        if let Some(els) = s.get("elements").and_then(|v| v.as_array()) {
            for el in els {
                let t = el.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                match t {
                    "text" => {
                        let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                        let text = strip_html(html);
                        let preset = el.get("preset").and_then(|v| v.as_str()).unwrap_or("text");
                        if !text.trim().is_empty() {
                            let (indent, marker) = match preset {
                                "title" => ("  ", "# "),
                                "body" => ("    ", "- "),
                                _ => ("    ", "  "),
                            };
                            for line in text.split('\n') {
                                if !line.trim().is_empty() {
                                    println!("{}{}{}", indent, marker, line.trim());
                                }
                            }
                        }
                    }
                    "image" => {
                        let src = el.get("src").and_then(|v| v.as_str()).unwrap_or("?");
                        println!("    [image: {}]", src);
                    }
                    "demo" | "demo-piece" => {
                        let src = el.get("src").or_else(|| el.get("demoSrc")).and_then(|v| v.as_str()).unwrap_or("?");
                        println!("    [demo: {}]", src);
                    }
                    _ => {}
                }
            }
        }
        let notes = s.get("notes").and_then(|v| v.as_str()).unwrap_or("");
        if !notes.is_empty() {
            println!("    Notes: {}", &notes[..80.min(notes.len())]);
        }
        println!();
    }
    Ok(())
}

fn cmd_search(args: &[String]) -> Result<(), String> {
    let query = args.join(" ");
    if query.is_empty() { return Err("Usage: search <query>".to_string()); }
    let query_lower = query.to_lowercase();
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;

    let mut found = 0;
    for (i, s) in slides.iter().enumerate() {
        if let Some(els) = s.get("elements").and_then(|v| v.as_array()) {
            for el in els {
                let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let text = strip_html(html);
                if text.to_lowercase().contains(&query_lower) {
                    let id = el.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                    let preset = el.get("preset").and_then(|v| v.as_str()).unwrap_or("?");
                    let lower = text.to_lowercase();
                    if let Some(idx) = lower.find(&query_lower) {
                        let start = idx.saturating_sub(20);
                        let end = (idx + query.len() + 20).min(text.len());
                        println!("  Slide {}, {} ({}): ...{}...", i + 1, &id[..8.min(id.len())], preset, &text[start..end]);
                        found += 1;
                    }
                }
            }
        }
    }
    if found == 0 { println!("No results for \"{}\"", query); }
    else { println!("\n{} match(es)", found); }
    Ok(())
}

fn cmd_validate() -> Result<(), String> {
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;

    let mut warnings = 0;

    // Check for orphan linkIds
    let mut link_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for s in slides {
        if let Some(els) = s.get("elements").and_then(|v| v.as_array()) {
            for el in els {
                if let Some(lid) = el.get("linkId").and_then(|v| v.as_str()) {
                    *link_counts.entry(lid.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    for (lid, count) in &link_counts {
        if *count == 1 {
            println!("  WARN: orphan linkId {}", &lid[..8.min(lid.len())]);
            warnings += 1;
        }
    }

    println!();
    if warnings == 0 { println!("✓ No issues found"); }
    else { println!("0 error(s), {} warning(s)", warnings); }
    Ok(())
}

fn cmd_history(args: &[String]) -> Result<(), String> {
    let _limit: usize = args.iter()
        .find(|a| a.starts_with("--limit="))
        .and_then(|a| a.split('=').nth(1)?.parse().ok())
        .unwrap_or(50);

    // Use the slides JSON to get element IDs, then query the DB directly
    // for temporal history. This is the one place we need raw DB access
    // beyond what the library provides.
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    // For now, just show current state with metadata
    let slides = p.get("slides").and_then(|v| v.as_array()).ok_or("No slides")?;
    println!("Current state: {} slides", slides.len());
    for (i, s) in slides.iter().enumerate() {
        let el_count = s.get("elements").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        println!("  Slide {}: {} elements", i + 1, el_count);
    }
    println!("\n(Full history requires direct DB access — use 'eigendeck-history.mjs' for detailed temporal view)");
    Ok(())
}

fn cmd_get_text(args: &[String]) -> Result<(), String> {
    let id_prefix = args.first().ok_or("Usage: get-text <element_id>")?;
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    for s in p.get("slides").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
        for el in s.get("elements").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
            let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if eid.starts_with(id_prefix.as_str()) {
                let html = el.get("html").and_then(|v| v.as_str()).unwrap_or("");
                println!("{}", strip_html(html));
                return Ok(());
            }
        }
    }
    Err(format!("Element {} not found", id_prefix))
}

fn cmd_set_text(args: &[String]) -> Result<(), String> {
    let id_prefix = args.first().ok_or("Usage: set-text <element_id> <text>")?;
    let text = args[1..].join(" ");

    // Find the element and update it
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    for s in p.get("slides").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
        for el in s.get("elements").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
            let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if eid.starts_with(id_prefix.as_str()) {
                let mut updated = el.clone();
                if let Some(obj) = updated.as_object_mut() {
                    obj.insert("html".to_string(), Value::String(text.clone()));
                }
                let link_id = el.get("linkId").and_then(|v| v.as_str()).map(|s| s.to_string());
                storage::db_update_element(eid.to_string(), updated.to_string(), link_id)?;
                println!("Updated {}", &eid[..8.min(eid.len())]);
                return Ok(());
            }
        }
    }
    Err(format!("Element {} not found", id_prefix))
}

fn cmd_add(args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: add <slide|text> ...")?;
    match what {
        "slide" => {
            let json_str = storage::db_get_slides()?;
            let slides: Vec<Value> = serde_json::from_str(&json_str).unwrap_or_default();
            let pos = slides.len() as i32;
            let id = uuid::Uuid::new_v4().to_string();
            storage::db_add_slide(id.clone(), pos, "default".to_string(), None)?;
            println!("Added slide {} at position {}", &id[..8], pos + 1);
        }
        "text" => {
            let slide_num: usize = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: add text <slide_num> <text>")?;
            let text = args[2..].join(" ");
            let slides_json = storage::db_get_slides()?;
            let slides: Vec<Value> = serde_json::from_str(&slides_json).unwrap_or_default();
            let slide = slides.get(slide_num - 1).ok_or("Slide not found")?;
            let slide_id = slide.get("id").and_then(|v| v.as_str()).ok_or("Bad slide")?;

            let el_id = uuid::Uuid::new_v4().to_string();
            let el_json = serde_json::json!({
                "id": el_id, "type": "text", "preset": "body", "html": text,
                "position": { "x": 80, "y": 240, "width": 1760, "height": 200 }
            });
            let elements_json = storage::db_get_slide_elements(slide_id.to_string())?;
            let elements: Vec<Value> = serde_json::from_str(&elements_json).unwrap_or_default();

            storage::db_add_element(
                slide_id.to_string(), el_id.clone(), "text".to_string(),
                el_json.to_string(), None, elements.len() as i32
            )?;
            println!("Added text element {} to slide {}", &el_id[..8], slide_num);
        }
        _ => return Err(format!("Unknown: add {}", what)),
    }
    Ok(())
}

fn cmd_insert(args: &[String]) -> Result<(), String> {
    if args.first().map(|s| s.as_str()) != Some("slide") {
        return Err("Usage: insert slide <N>".to_string());
    }
    let pos: i32 = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: insert slide <N>")?;
    let id = uuid::Uuid::new_v4().to_string();
    storage::db_add_slide(id.clone(), pos - 1, "default".to_string(), None)?;
    println!("Inserted slide {} at position {}", &id[..8], pos);
    Ok(())
}

fn cmd_remove(args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: remove <slide|element> ...")?;
    match what {
        "slide" => {
            let num: usize = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: remove slide <N>")?;
            let slides_json = storage::db_get_slides()?;
            let slides: Vec<Value> = serde_json::from_str(&slides_json).unwrap_or_default();
            let slide = slides.get(num - 1).ok_or("Slide not found")?;
            let slide_id = slide.get("id").and_then(|v| v.as_str()).ok_or("Bad slide")?;
            storage::db_delete_slide(slide_id.to_string())?;
            println!("Removed slide {}", num);
        }
        "element" => {
            let id_prefix = args.get(1).ok_or("Usage: remove element <id> [slide_num]")?;
            // Find full ID
            let json_str = storage::db_export_json()?;
            let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            for s in p.get("slides").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
                let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                for el in s.get("elements").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
                    let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if eid.starts_with(id_prefix.as_str()) {
                        storage::db_remove_element_from_slide(sid.to_string(), eid.to_string())?;
                        println!("Removed {} from slide", &eid[..8.min(eid.len())]);
                        return Ok(());
                    }
                }
            }
            return Err(format!("Element {} not found", id_prefix));
        }
        _ => return Err(format!("Unknown: remove {}", what)),
    }
    Ok(())
}

fn cmd_move(args: &[String]) -> Result<(), String> {
    let what = args.first().map(|s| s.as_str()).ok_or("Usage: move <slide|element> ...")?;
    match what {
        "slide" => {
            let from: usize = args.get(1).and_then(|s| s.parse().ok()).ok_or("Usage: move slide <from> <to>")?;
            let to: i32 = args.get(2).and_then(|s| s.parse().ok()).ok_or("Usage: move slide <from> <to>")?;
            let slides_json = storage::db_get_slides()?;
            let slides: Vec<Value> = serde_json::from_str(&slides_json).unwrap_or_default();
            let slide = slides.get(from - 1).ok_or("Slide not found")?;
            let slide_id = slide.get("id").and_then(|v| v.as_str()).ok_or("Bad slide")?;
            storage::db_move_slide(slide_id.to_string(), to - 1)?;
            println!("Moved slide {} to position {}", from, to);
        }
        "element" => {
            let id_prefix = args.get(1).ok_or("Usage: move element <id> <x> <y>")?;
            let x: f64 = args.get(2).and_then(|s| s.parse().ok()).ok_or("Usage: move element <id> <x> <y>")?;
            let y: f64 = args.get(3).and_then(|s| s.parse().ok()).ok_or("Usage: move element <id> <x> <y>")?;

            let json_str = storage::db_export_json()?;
            let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            for s in p.get("slides").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
                for el in s.get("elements").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
                    let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if eid.starts_with(id_prefix.as_str()) {
                        let mut updated = el.clone();
                        if let Some(pos) = updated.get_mut("position").and_then(|v| v.as_object_mut()) {
                            pos.insert("x".to_string(), serde_json::json!(x));
                            pos.insert("y".to_string(), serde_json::json!(y));
                        }
                        let link_id = el.get("linkId").and_then(|v| v.as_str()).map(|s| s.to_string());
                        storage::db_update_element(eid.to_string(), updated.to_string(), link_id)?;
                        println!("Moved {} to ({}, {})", &eid[..8.min(eid.len())], x, y);
                        return Ok(());
                    }
                }
            }
            return Err(format!("Element {} not found", id_prefix));
        }
        _ => return Err(format!("Unknown: move {}", what)),
    }
    Ok(())
}

fn cmd_edit(args: &[String]) -> Result<(), String> {
    if args.first().map(|s| s.as_str()) != Some("element") {
        return Err("Usage: edit element <id> <json>".to_string());
    }
    let id_prefix = args.get(1).ok_or("Usage: edit element <id> <json>")?;
    let json_str = args[2..].join(" ");
    let _new_data: Value = serde_json::from_str(&json_str).map_err(|e| format!("Invalid JSON: {}", e))?;

    let export = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&export).map_err(|e| e.to_string())?;
    for s in p.get("slides").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
        for el in s.get("elements").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
            let eid = el.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if eid.starts_with(id_prefix.as_str()) {
                let link_id = el.get("linkId").and_then(|v| v.as_str()).map(|s| s.to_string());
                storage::db_update_element(eid.to_string(), json_str.clone(), link_id)?;
                println!("Updated {}", &eid[..8.min(eid.len())]);
                return Ok(());
            }
        }
    }
    Err(format!("Element {} not found", id_prefix))
}

fn cmd_export(args: &[String]) -> Result<(), String> {
    let format = args.first().map(|s| s.as_str()).ok_or("Usage: export <json> [output]")?;
    let output = args.get(1);
    match format {
        "json" => {
            let json = storage::db_export_json()?;
            if let Some(path) = output {
                std::fs::write(path, &json).map_err(|e| e.to_string())?;
                println!("Exported to {}", path);
            } else {
                println!("{}", json);
            }
        }
        _ => return Err(format!("Unknown format: {} (supported: json)", format)),
    }
    Ok(())
}

fn cmd_compact(args: &[String]) -> Result<(), String> {
    let all = args.iter().any(|a| a == "--all");
    let result = storage::db_compact(all)?;
    let parsed: Value = serde_json::from_str(&result).unwrap_or(Value::Null);
    let saved = parsed.get("savedBytes").and_then(|v| v.as_i64()).unwrap_or(0);
    println!("Compacted. Saved {} bytes.", saved);
    Ok(())
}

fn cmd_unpack(db_path: &str, args: &[String]) -> Result<(), String> {
    let demos_only = args.iter().any(|a| a == "--demos");
    let images_only = args.iter().any(|a| a == "--images");
    let output_dir = args.iter()
        .position(|a| a == "--output")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str());

    let base_dir = output_dir.unwrap_or_else(|| {
        db_path.strip_suffix(".eigendeck").unwrap_or(db_path)
    });

    if std::path::Path::new(base_dir).exists() && output_dir.is_none() {
        return Err(format!("{} already exists. Use --output <dir>.", base_dir));
    }

    // Get assets via raw SQL (db_get_asset only gets one at a time)
    // This is acceptable since unpack is a bulk operation
    let json_str = storage::db_export_json()?;
    let p: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    // Collect asset paths from elements
    let mut asset_paths = std::collections::HashSet::new();
    if let Some(slides) = p.get("slides").and_then(|v| v.as_array()) {
        for s in slides {
            if let Some(els) = s.get("elements").and_then(|v| v.as_array()) {
                for el in els {
                    if let Some(src) = el.get("src").and_then(|v| v.as_str()) {
                        if !src.starts_with("data:") { asset_paths.insert(src.to_string()); }
                    }
                    if let Some(src) = el.get("demoSrc").and_then(|v| v.as_str()) {
                        asset_paths.insert(src.to_string());
                    }
                }
            }
        }
    }

    let mut count = 0;
    for path in &asset_paths {
        let is_demo = path.starts_with("demos/");
        let is_image = path.starts_with("images/");
        if demos_only && !is_demo { continue; }
        if images_only && !is_image { continue; }

        match storage::db_get_asset(path.clone()) {
            Ok(data) => {
                let full_path = format!("{}/{}", base_dir, path);
                let dir = std::path::Path::new(&full_path).parent().unwrap();
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                std::fs::write(&full_path, &data).map_err(|e| e.to_string())?;
                count += 1;
            }
            Err(_) => eprintln!("  Warning: asset {} not found in DB", path),
        }
    }
    println!("Unpacked {} files to {}", count, base_dir);
    Ok(())
}

// UUID helper (minimal, no external crate)
mod uuid {
    pub struct Uuid;
    impl Uuid {
        pub fn new_v4() -> UuidResult {
            use std::time::{SystemTime, UNIX_EPOCH};
            let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
            let a = d.as_nanos();
            use std::sync::atomic::{AtomicU64, Ordering};
            static CTR: AtomicU64 = AtomicU64::new(0);
            let c = CTR.fetch_add(1, Ordering::Relaxed);
            UuidResult(format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
                ((a >> 96) as u32).wrapping_add(c as u32),
                (a >> 80) as u16 & 0xffff,
                (a >> 64) as u16 & 0xfff,
                0x8000 | ((a >> 48) as u16 & 0x3fff),
                a as u64 & 0xffffffffffff))
        }
    }
    pub struct UuidResult(String);
    impl UuidResult {
        pub fn to_string(&self) -> String { self.0.clone() }
    }
}
