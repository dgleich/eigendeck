#![allow(deprecated)] // cocoa crate deprecation warnings — TODO: migrate to objc2

pub mod storage;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Store recent project paths so we can map menu item IDs back to paths
static RECENT_PATHS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

// CLI export mode: store args for the hidden webview to retrieve
static CLI_EXPORT_ARGS: Lazy<Mutex<Option<(String, String)>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
fn cli_export_args() -> Result<serde_json::Value, String> {
    let args = CLI_EXPORT_ARGS.lock().unwrap();
    match args.as_ref() {
        Some((db, out)) => Ok(serde_json::json!({ "dbPath": db, "outputPath": out })),
        None => Err("Not in export mode".into()),
    }
}

#[tauri::command]
fn cli_write_and_exit(path: String, content: String, error: Option<String>) -> Result<(), String> {
    if let Some(e) = error {
        eprintln!("Export failed: {}", e);
        std::process::exit(1);
    }
    if path.is_empty() {
        std::process::exit(1);
    }
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))?;
    println!("Exported to {}", path);
    std::process::exit(0);
}

/// Set window level above the menu bar on macOS so it covers everything
/// on the secondary monitor (including the menu bar strip).
#[tauri::command]
fn set_window_above_menubar(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;

    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSWindow;
        use cocoa::base::id;

        let ns_win: id = window.ns_window().map_err(|e| e.to_string())? as id;
        unsafe {
            // kCGMainMenuWindowLevel = 24. Level 25 is above the menu bar.
            ns_win.setLevel_(25);
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(())
}

/// Check if displays are mirrored and return info about available displays.
#[tauri::command]
fn check_display_mirroring() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        use core_graphics::display::*;

        unsafe {
            let max_displays: u32 = 16;
            let mut displays = vec![0u32; max_displays as usize];
            let mut display_count: u32 = 0;

            let err = CGGetActiveDisplayList(max_displays, displays.as_mut_ptr(), &mut display_count);
            if err != 0 {
                return Err(format!("CGGetActiveDisplayList failed: {}", err));
            }

            displays.truncate(display_count as usize);
            let main_display = CGMainDisplayID();

            let mut is_mirrored = false;
            let mut mirror_source: u32 = 0;
            let mut secondary_display: u32 = 0;

            for &d in &displays {
                let mirror = CGDisplayMirrorsDisplay(d);
                if mirror != 0 {
                    is_mirrored = true;
                    mirror_source = mirror;
                    secondary_display = d;
                    break;
                }
            }

            // If not mirrored, find secondary display
            if !is_mirrored {
                for &d in &displays {
                    if d != main_display {
                        secondary_display = d;
                        break;
                    }
                }
            }

            Ok(serde_json::json!({
                "displayCount": display_count,
                "mainDisplay": main_display,
                "secondaryDisplay": secondary_display,
                "isMirrored": is_mirrored,
                "mirrorSource": mirror_source,
            }))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({
            "displayCount": 1,
            "mainDisplay": 0,
            "secondaryDisplay": 0,
            "isMirrored": false,
            "mirrorSource": 0,
        }))
    }
}

/// Disable display mirroring (un-mirror). Returns true if mirroring was disabled.
#[tauri::command]
fn disable_display_mirroring() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use core_graphics::display::*;

        unsafe {
            let max_displays: u32 = 16;
            let mut displays = vec![0u32; max_displays as usize];
            let mut display_count: u32 = 0;

            let err = CGGetActiveDisplayList(max_displays, displays.as_mut_ptr(), &mut display_count);
            if err != 0 {
                return Err(format!("CGGetActiveDisplayList failed: {}", err));
            }

            displays.truncate(display_count as usize);

            // Find a mirrored display
            let mut mirrored_display: u32 = 0;
            for &d in &displays {
                if CGDisplayMirrorsDisplay(d) != 0 {
                    mirrored_display = d;
                    break;
                }
            }

            if mirrored_display == 0 {
                return Ok(false); // Not mirrored
            }

            // Disable mirroring
            let mut config: CGDisplayConfigRef = std::ptr::null_mut();
            let err = CGBeginDisplayConfiguration(&mut config);
            if err != 0 {
                return Err(format!("CGBeginDisplayConfiguration failed: {}", err));
            }

            // Setting mirror to kCGNullDirectDisplay (0) disables mirroring
            let err = CGConfigureDisplayMirrorOfDisplay(config, mirrored_display, 0);
            if err != 0 {
                CGCancelDisplayConfiguration(config);
                return Err(format!("CGConfigureDisplayMirrorOfDisplay failed: {}", err));
            }

            let err = CGCompleteDisplayConfiguration(config, CGConfigureOption::ConfigureForSession);
            if err != 0 {
                return Err(format!("CGCompleteDisplayConfiguration failed: {}", err));
            }

            Ok(true)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// Re-enable display mirroring (mirror secondary to main).
#[tauri::command]
fn enable_display_mirroring() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use core_graphics::display::*;

        unsafe {
            let max_displays: u32 = 16;
            let mut displays = vec![0u32; max_displays as usize];
            let mut display_count: u32 = 0;

            let err = CGGetActiveDisplayList(max_displays, displays.as_mut_ptr(), &mut display_count);
            if err != 0 {
                return Err(format!("CGGetActiveDisplayList failed: {}", err));
            }

            displays.truncate(display_count as usize);

            if display_count < 2 {
                return Ok(false); // Only one display
            }

            let main_display = CGMainDisplayID();
            let mut secondary_display: u32 = 0;
            for &d in &displays {
                if d != main_display {
                    secondary_display = d;
                    break;
                }
            }

            if secondary_display == 0 {
                return Ok(false);
            }

            // Enable mirroring: mirror secondary to main
            let mut config: CGDisplayConfigRef = std::ptr::null_mut();
            let err = CGBeginDisplayConfiguration(&mut config);
            if err != 0 {
                return Err(format!("CGBeginDisplayConfiguration failed: {}", err));
            }

            let err = CGConfigureDisplayMirrorOfDisplay(config, secondary_display, main_display);
            if err != 0 {
                CGCancelDisplayConfiguration(config);
                return Err(format!("CGConfigureDisplayMirrorOfDisplay failed: {}", err));
            }

            let err = CGCompleteDisplayConfiguration(config, CGConfigureOption::ConfigureForSession);
            if err != 0 {
                return Err(format!("CGCompleteDisplayConfiguration failed: {}", err));
            }

            Ok(true)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// Update the "Open Recent" submenu with the given list of recent projects.
#[tauri::command]
fn update_recent_menu(app: tauri::AppHandle, projects: Vec<serde_json::Value>) -> Result<(), String> {
    // Store paths for lookup when menu items are clicked
    let paths: Vec<String> = projects
        .iter()
        .filter_map(|p| p.get("path").and_then(|v| v.as_str()).map(String::from))
        .collect();
    *RECENT_PATHS.lock().unwrap() = paths;

    // Build the "Open Recent" submenu
    let mut recent_sub = SubmenuBuilder::new(&app, "Open Recent");

    if projects.is_empty() {
        let empty = MenuItemBuilder::new("No Recent Projects")
            .id("recent-empty")
            .enabled(false)
            .build(&app)
            .map_err(|e| e.to_string())?;
        recent_sub = recent_sub.item(&empty);
    } else {
        for (i, proj) in projects.iter().enumerate() {
            let title = proj.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let dir = proj.get("path").and_then(|v| v.as_str())
                .and_then(|p| p.rsplit('/').next())
                .unwrap_or("");
            let label = if dir.is_empty() { title.to_string() } else { format!("{} — {}", title, dir) };
            let item = MenuItemBuilder::new(&label)
                .id(format!("recent-{}", i))
                .build(&app)
                .map_err(|e| e.to_string())?;
            recent_sub = recent_sub.item(&item);
        }
    }

    let recent_menu = recent_sub.build().map_err(|e| e.to_string())?;

    let menu = build_app_menu(&app, Some(recent_menu))?;
    app.set_menu(menu).map_err(|e| e.to_string())?;

    Ok(())
}

/// Build the complete application menu bar. Called from both setup() and update_recent_menu().
fn build_app_menu(app: &tauri::AppHandle, recent_menu: Option<tauri::menu::Submenu<tauri::Wry>>) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let app_menu = SubmenuBuilder::new(app, "Eigendeck")
        .about(Some(AboutMetadata {
            name: Some("Eigendeck".into()),
            version: Some("0.1.0".into()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
        .map_err(|e| e.to_string())?;

    let new_item = MenuItemBuilder::new("New Project").id("new-project").accelerator("CmdOrCtrl+N")
        .build(app).map_err(|e| e.to_string())?;
    let open_item = MenuItemBuilder::new("Open Project").id("open-project").accelerator("CmdOrCtrl+O")
        .build(app).map_err(|e| e.to_string())?;
    let save_item = MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S")
        .build(app).map_err(|e| e.to_string())?;
    let export_item = MenuItemBuilder::new("Export to HTML").id("export").accelerator("CmdOrCtrl+Shift+E")
        .build(app).map_err(|e| e.to_string())?;
    let import_item = MenuItemBuilder::new("Import from HTML...").id("import-html")
        .build(app).map_err(|e| e.to_string())?;

    let mut file_sub = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&open_item);
    if let Some(ref rm) = recent_menu {
        file_sub = file_sub.item(rm);
    }
    let file_menu = file_sub
        .separator()
        .item(&save_item)
        .item(&export_item)
        .item(&import_item)
        .separator()
        .close_window()
        .build()
        .map_err(|e| e.to_string())?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo().redo().separator().cut().copy().paste().select_all()
        .build().map_err(|e| e.to_string())?;

    let present_item = MenuItemBuilder::new("Present Mode").id("present").accelerator("F5")
        .build(app).map_err(|e| e.to_string())?;
    let speaker_item = MenuItemBuilder::new("Toggle Speaker Notes").id("speaker").accelerator("CmdOrCtrl+Shift+S")
        .build(app).map_err(|e| e.to_string())?;
    // No accelerator — Cmd+I is handled in JS (italic in contentEditable, inspector otherwise)
    let inspector_item = MenuItemBuilder::new("Toggle Inspector").id("inspector")
        .build(app).map_err(|e| e.to_string())?;
    let history_item = MenuItemBuilder::new("History").id("history").accelerator("CmdOrCtrl+Shift+H")
        .build(app).map_err(|e| e.to_string())?;
    let debug_item = MenuItemBuilder::new("Debug Console").id("debug-console").accelerator("CmdOrCtrl+Shift+D")
        .build(app).map_err(|e| e.to_string())?;
    let devtools_item = MenuItemBuilder::new("Developer Tools").id("devtools").accelerator("CmdOrCtrl+Alt+I")
        .build(app).map_err(|e| e.to_string())?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&present_item)
        .item(&speaker_item)
        .item(&inspector_item)
        .item(&history_item)
        .separator()
        .item(&debug_item)
        .item(&devtools_item)
        .separator()
        .fullscreen()
        .build()
        .map_err(|e| e.to_string())?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize().maximize().separator().close_window()
        .build().map_err(|e| e.to_string())?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_window_above_menubar,
            check_display_mirroring,
            disable_display_mirroring,
            enable_display_mirroring,
            update_recent_menu,
            storage::db_open,
            storage::db_open_memory,
            storage::db_save_to_file,
            storage::db_close,
            storage::db_import_json,
            storage::db_export_json,
            storage::db_get_slides,
            storage::db_get_slide_elements,
            storage::db_update_element,
            storage::db_add_element,
            storage::db_remove_element_from_slide,
            storage::db_compact,
            storage::db_get_history,
            storage::db_get_history_timestamps,
            storage::db_get_state_at,
            storage::db_checkpoint,
            storage::db_add_slide,
            storage::db_delete_slide,
            storage::db_duplicate_slide,
            storage::db_move_slide,
            storage::db_update_slide,
            storage::db_update_z_order,
            storage::db_free_element,
            storage::db_store_asset,
            storage::db_get_asset,
            storage::db_update_presentation,
            cli_export_args,
            cli_write_and_exit,
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Check for --export CLI mode
            let args: Vec<String> = std::env::args().collect();
            if let Some(idx) = args.iter().position(|a| a == "--export") {
                let db_path = args.get(idx + 1).cloned().unwrap_or_default();
                let out_path = args.get(idx + 2).cloned().unwrap_or_default();
                if db_path.is_empty() || out_path.is_empty() {
                    eprintln!("Usage: eigendeck --export <file.eigendeck> <output.html>");
                    std::process::exit(1);
                }
                // Store args for the JS export script to retrieve
                *CLI_EXPORT_ARGS.lock().unwrap() = Some((db_path, out_path));

                // Hide the default main window
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.hide();
                    // Navigate to the export entry point
                    let _ = main_win.eval("window.location.href = '/export-cli.html'");
                }
                return Ok(());
            }

            // Build menu bar (shared function — also used by update_recent_menu)
            let menu = build_app_menu(app.handle(), None)
                .map_err(|e| e.to_string())?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if let Some(window) = app_handle.get_webview_window("main") {
                    // Handle devtools toggle on Rust side
                    if id == "devtools" {
                        #[cfg(debug_assertions)]
                        {
                            if window.is_devtools_open() {
                                window.close_devtools();
                            } else {
                                window.open_devtools();
                            }
                        }
                        return;
                    }
                    // Handle recent project menu items
                    if let Some(idx_str) = id.strip_prefix("recent-") {
                        if let Ok(idx) = idx_str.parse::<usize>() {
                            let paths = RECENT_PATHS.lock().unwrap();
                            if let Some(path) = paths.get(idx) {
                                let _ = window.emit("menu-event-recent", path.as_str());
                                return;
                            }
                        }
                    }
                    let _ = window.emit("menu-event", id);
                }
            });

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Checkpoint WAL and close SQLite on window close
                let _ = storage::close_db();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
