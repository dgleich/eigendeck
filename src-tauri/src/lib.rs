
pub mod storage;

use tauri::menu::{AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

mod clip;
mod debug;
mod pasteboard;
mod pdf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Store recent project paths so we can map menu item IDs back to paths
static RECENT_PATHS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

// CLI export mode: store args for the hidden webview to retrieve
static CLI_EXPORT_ARGS: Lazy<Mutex<Option<(String, String)>>> = Lazy::new(|| Mutex::new(None));

// A .eigendeck path the app was launched to open (double-click / "open
// with"). On Linux/Windows the OS passes it as a CLI arg; on macOS it
// arrives via RunEvent::Opened. Drained once by the frontend on boot via
// take_launch_file; warm opens (app already running) are pushed straight to
// the window as an "open-file" event instead.
static PENDING_OPEN_FILE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// First existing `*.eigendeck` path in `args` (skips argv[0] and flags).
/// Used to open a deck the OS handed us on double-click / "open with".
fn first_eigendeck_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-')
            && a.ends_with(".eigendeck")
            && std::path::Path::new(a).is_file())
        .cloned()
}

/// Return (and clear) a .eigendeck path the app was launched to open, if
/// any. The frontend calls this once on boot and opens the deck.
#[tauri::command]
fn take_launch_file() -> Option<String> {
    PENDING_OPEN_FILE.lock().unwrap().take()
}

#[tauri::command]
fn force_quit() {
    let _ = storage::close_db();
    std::process::exit(0);
}

/// Show the macOS-native unsaved-changes dialog using NSAlert.
/// Returns "save" | "cancel" | "discard" | "fallback" (non-mac).
///
/// NSAlert must run on the main thread; we use AppHandle::run_on_main_thread
/// and a oneshot channel to get the response back to the worker thread that
/// the Tauri command runs on.
#[tauri::command]
fn show_unsaved_dialog(_app: tauri::AppHandle, title: String, has_file: bool) -> String {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<String>();
        let _ = _app.run_on_main_thread(move || {
            let result = mac_show_unsaved_dialog(&title, has_file);
            let _ = tx.send(result);
        });
        // Block worker thread until main thread reports back. The dialog
        // is modal; the main thread is busy in runModal, but our channel
        // recv is on a non-main thread so this is safe.
        rx.recv().unwrap_or_else(|_| "cancel".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, has_file);
        // Non-mac platforms: tell the JS to fall back to its in-app modal.
        "fallback".into()
    }
}

#[cfg(target_os = "macos")]
fn mac_show_unsaved_dialog(title: &str, has_file: bool) -> String {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertStyle};
    use objc2_foundation::NSString;

    let (heading, body, destructive_label) = if has_file {
        (
            format!("Do you want to save the changes you made to \u{201C}{}\u{201D}?", title),
            "Your changes will be lost if you don\u{2019}t save them.".to_string(),
            "Don\u{2019}t Save".to_string(),
        )
    } else {
        (
            format!("Do you want to keep this new document \u{201C}{}\u{201D}?", title),
            "You can choose to save your changes, or delete this document immediately. You can\u{2019}t undo this action.".to_string(),
            "Delete and Quit".to_string(),
        )
    };

    let save_label = if has_file { "Save" } else { "Save\u{2026}" };

    // We're on the main thread (caller dispatches via run_on_main_thread),
    // so MainThreadMarker::new() succeeds.
    let mtm = MainThreadMarker::new()
        .expect("show_unsaved_dialog must run on the main thread");

    // Order matters: addButtonWithTitle assigns return values
    // 1000, 1001, 1002 in the order added. The FIRST button is the
    // default (Save) — Enter activates it and it's rendered rightmost
    // on macOS. Cancel/destructive come after.
    //
    // objc2's typed wrappers make all of these calls safe (they validate
    // selector and argument types at compile time), so no unsafe block
    // is needed.
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(&heading));
    alert.setInformativeText(&NSString::from_str(&body));
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.addButtonWithTitle(&NSString::from_str(save_label));
    alert.addButtonWithTitle(&NSString::from_str("Cancel"));
    alert.addButtonWithTitle(&NSString::from_str(&destructive_label));

    // NSModalResponse: NSAlertFirstButtonReturn = 1000, etc.
    match alert.runModal() as i64 {
        1000 => "save".into(),
        1001 => "cancel".into(),
        1002 => "discard".into(),
        _ => "cancel".into(),
    }
}

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
        use objc2_app_kit::NSWindow;

        // Tauri returns the NSWindow* as a raw pointer; cast to a typed
        // objc2 reference. Safety: the pointer is non-null and points to a
        // valid NSWindow owned by Tauri's webview for the lifetime of the
        // window.
        let ns_win_ptr = window.ns_window().map_err(|e| e.to_string())?;
        let ns_win: &NSWindow = unsafe { &*(ns_win_ptr as *const NSWindow) };
        // kCGMainMenuWindowLevel = 24. Level 25 is above the menu bar.
        // setLevel is a safe property setter in objc2-app-kit.
        ns_win.setLevel(25);
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
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&MenuItemBuilder::new("Settings...").id("settings").accelerator("CmdOrCtrl+,")
            .build(app).map_err(|e| e.to_string())?)
        .separator()
        .item(&MenuItemBuilder::new("Quit Eigendeck").id("quit").accelerator("CmdOrCtrl+Q")
            .build(app).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    let new_item = MenuItemBuilder::new("New Project").id("new-project").accelerator("CmdOrCtrl+N")
        .build(app).map_err(|e| e.to_string())?;
    let open_item = MenuItemBuilder::new("Open Project").id("open-project").accelerator("CmdOrCtrl+O")
        .build(app).map_err(|e| e.to_string())?;
    let save_item = MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S")
        .build(app).map_err(|e| e.to_string())?;
    let save_as_item = MenuItemBuilder::new("Save As...").id("save-as").accelerator("CmdOrCtrl+Shift+S")
        .build(app).map_err(|e| e.to_string())?;
    let export_item = MenuItemBuilder::new("Export to HTML").id("export").accelerator("CmdOrCtrl+Shift+E")
        .build(app).map_err(|e| e.to_string())?;
    let export_pdf_item = MenuItemBuilder::new("Export Printable HTML...").id("export-pdf").accelerator("CmdOrCtrl+Shift+P")
        .build(app).map_err(|e| e.to_string())?;
    let export_pdf_ss_item = MenuItemBuilder::new("Export to PDF (Screenshots)...").id("export-pdf-screenshots")
        .build(app).map_err(|e| e.to_string())?;
    let import_item = MenuItemBuilder::new("Import from HTML...").id("import-html")
        .build(app).map_err(|e| e.to_string())?;
    let presentation_settings_item = MenuItemBuilder::new("Presentation Settings...").id("presentation-settings")
        .build(app).map_err(|e| e.to_string())?;
    let gc_assets_item = MenuItemBuilder::new("Compact (Free Unused Assets)").id("gc-assets")
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
        .item(&save_as_item)
        .item(&export_item)
        .item(&export_pdf_item)
        .item(&export_pdf_ss_item)
        .item(&import_item)
        .separator()
        .item(&presentation_settings_item)
        .item(&gc_assets_item)
        .separator()
        .close_window()
        .build()
        .map_err(|e| e.to_string())?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo().redo().separator().cut().copy().paste()
        .item(&MenuItemBuilder::new("Paste without Formatting").id("paste-plain")
            .build(app).map_err(|e| e.to_string())?)
        .select_all()
        .build().map_err(|e| e.to_string())?;

    // Insert menu — every insertable element type, ALWAYS available
    // regardless of which buttons the user hid from the editor toolbar
    // (Settings → Toolbar buttons). Ids mirror src/lib/insertItems.ts,
    // prefixed `insert-`; the JS `menu-event` handler routes them through
    // `runInsert`. Items that open a file dialog get an ellipsis.
    let insert_menu = SubmenuBuilder::new(app, "Insert")
        .item(&MenuItemBuilder::new("Title").id("insert-title").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Body").id("insert-body").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Text Box").id("insert-textbox").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Note").id("insert-note").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Footnote").id("insert-footnote").build(app).map_err(|e| e.to_string())?)
        .separator()
        .item(&MenuItemBuilder::new("Arrow").id("insert-arrow").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Cover Rectangle").id("insert-cover").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Image…").id("insert-image").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Hype Note").id("insert-hype").build(app).map_err(|e| e.to_string())?)
        .separator()
        .item(&MenuItemBuilder::new("Demo (HTML)…").id("insert-demo").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Notebook…").id("insert-notebook").build(app).map_err(|e| e.to_string())?)
        .item(&MenuItemBuilder::new("Video…").id("insert-video").build(app).map_err(|e| e.to_string())?)
        .build().map_err(|e| e.to_string())?;

    let present_item = MenuItemBuilder::new("Present Mode").id("present").accelerator("F5")
        .build(app).map_err(|e| e.to_string())?;
    // Explicit single-window present on the current screen — bypasses projector
    // mode regardless of the "Present will try projector mode" preference.
    let test_present_single_item = MenuItemBuilder::new("Present in This Window").id("test-present-single")
        .build(app).map_err(|e| e.to_string())?;
    // Screen-share presentation: dual-window present on a single screen — a
    // chromeless, non-fullscreen live-slide window (shareable over Zoom/Meet)
    // plus the speaker view in the main window.
    let screen_share_item = MenuItemBuilder::new("Screen Share Presentation").id("screen-share-present")
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
    let decorations_item = MenuItemBuilder::new("Hide Window Chrome").id("toggle-decorations").accelerator("CmdOrCtrl+Shift+F")
        .build(app).map_err(|e| e.to_string())?;
    let devtools_item = MenuItemBuilder::new("Developer Tools").id("devtools").accelerator("CmdOrCtrl+Alt+I")
        .build(app).map_err(|e| e.to_string())?;
    // Alignment grid (editor-only). Check items — muda toggles the checkmark
    // on click; the catch-all menu-event handler relays the id to JS, which
    // flips the matching store flag. checked(false) is REQUIRED: without it
    // the items render CHECKED at launch while the store starts false, so the
    // checkmark is inverted forever. Pinning the initial state to false (the
    // store default) keeps muda's per-click toggle in sync with the store.
    let snap_grid_item = CheckMenuItemBuilder::new("Snap to Grid").id("toggle-snap-grid")
        .checked(false).build(app).map_err(|e| e.to_string())?;
    let show_grid_item = CheckMenuItemBuilder::new("Show Grid Points").id("toggle-show-grid")
        .checked(false).build(app).map_err(|e| e.to_string())?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&present_item)
        .item(&screen_share_item)
        .item(&test_present_single_item)
        .separator()
        .item(&speaker_item)
        .item(&inspector_item)
        .item(&history_item)
        .separator()
        .item(&snap_grid_item)
        .item(&show_grid_item)
        .separator()
        .item(&decorations_item)
        .separator()
        .item(&debug_item)
        .item(&devtools_item)
        .separator()
        .fullscreen()
        .build()
        .map_err(|e| e.to_string())?;

    // Slide menu — slide operations + the Slide/Deck inspector entries (makes the
    // per-slide and presentation-wide inspectors discoverable without the toolbar).
    let slide_new_item = MenuItemBuilder::new("New Slide").id("slide-new").accelerator("CmdOrCtrl+Shift+N")
        .build(app).map_err(|e| e.to_string())?;
    let slide_dup_item = MenuItemBuilder::new("Duplicate Slide").id("slide-duplicate").accelerator("CmdOrCtrl+D")
        .build(app).map_err(|e| e.to_string())?;
    let slide_del_item = MenuItemBuilder::new("Delete Slide").id("slide-delete")
        .build(app).map_err(|e| e.to_string())?;
    let slide_props_item = MenuItemBuilder::new("Slide Properties").id("slide-properties")
        .build(app).map_err(|e| e.to_string())?;
    let deck_props_item = MenuItemBuilder::new("Presentation Properties").id("deck-properties")
        .build(app).map_err(|e| e.to_string())?;
    let slide_menu = SubmenuBuilder::new(app, "Slide")
        .item(&slide_new_item)
        .item(&slide_dup_item)
        .item(&slide_del_item)
        .separator()
        .item(&slide_props_item)
        .item(&deck_props_item)
        .build()
        .map_err(|e| e.to_string())?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize().maximize().separator().close_window()
        .build().map_err(|e| e.to_string())?;

    // Debug submenu — appended ONLY when launched with --debug. The flag is
    // read inside debug::attach_submenu_if_enabled; lib.rs never sees the bool.
    let debug_menu = debug::attach_submenu_if_enabled(app)?;

    let mut bar = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&insert_menu)
        .item(&slide_menu)
        .item(&window_menu);
    if let Some(ref dm) = debug_menu {
        bar = bar.item(dm);
    }
    bar.build().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse --debug ONCE here. Stored as managed state; only the debug module
    // reads it. Nothing else may branch on this flag (see debug.rs).
    let debug_flag = debug::DebugFlag(debug::parse_debug_flag());

    tauri::Builder::default()
        .manage(debug_flag)
        .invoke_handler(tauri::generate_handler![
            debug::debug_enabled,
            pasteboard::pasteboard_list_types,
            pasteboard::pasteboard_read_type,
            pasteboard::pasteboard_list_drag_types,
            pasteboard::pasteboard_read_drag_type,
            clip::clip_copy_asset,
            clip::clip_peek_internal,
            clip::clip_paste_asset,
            clip::clip_clear_internal,
            set_window_above_menubar,
            check_display_mirroring,
            disable_display_mirroring,
            enable_display_mirroring,
            update_recent_menu,
            take_launch_file,
            storage::db_open,
            storage::db_open_memory,
            storage::db_save_to_file,
            storage::db_save_as_to_file,
            storage::db_get_project_id,
            storage::db_close,
            storage::db_import_json,
            storage::db_export_json,
            storage::db_export_json_with_assets,
            storage::db_get_slides,
            storage::db_get_slide_elements,
            storage::db_update_element,
            storage::db_add_element,
            storage::db_add_element_to_slide,
            storage::db_remove_element_from_slide,
            storage::db_element_exists,
            storage::db_compact,
            storage::db_gc_assets,
            pdf::db_render_pdf_page,
            pdf::db_pdf_page_count,
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
            storage::db_get_asset_by_id,
            storage::db_get_owned_asset_id,
            storage::db_close_owned_overlay,
            storage::db_get_asset_version,
            storage::db_get_asset_external_path,
            storage::db_get_asset_meta_by_path,
            storage::db_get_asset_meta_by_id,
            storage::db_get_asset_history,
            storage::db_restore_asset_version,
            storage::db_set_asset_auto_reload,
            storage::db_list_linked_assets,
            storage::db_put_math_svg,
            storage::db_get_math_svg,
            storage::db_load_math_cache,
            storage::db_put_asset_cache,
            storage::db_get_asset_cache,
            storage::db_get_asset_cache_bytes,
            storage::db_downscale_asset_cache,
            storage::db_list_asset_cache_variants,
            storage::db_clear_asset_cache,
            storage::db_update_presentation,
            force_quit,
            show_unsaved_dialog,
            cli_export_args,
            cli_write_and_exit,
        ])
        // MUST be the first plugin. A second launch (e.g. double-clicking
        // another .eigendeck while the app is open) forwards its args to THIS
        // instance and exits, instead of spawning a duplicate process that
        // would fight over the same SQLite file. We focus the window and push
        // the file as an "open-file" event for the frontend to open safely.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
                if let Some(path) = first_eigendeck_path(&argv) {
                    let _ = win.emit("open-file", path);
                }
            }
        }))
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

            // Launched by double-clicking / "open with" a .eigendeck? On
            // Linux/Windows the OS passes the file as a CLI arg. Stash it for
            // the frontend to open on boot (take_launch_file). macOS delivers
            // it via RunEvent::Opened instead (handled in run()).
            if let Some(path) = first_eigendeck_path(&args) {
                *PENDING_OPEN_FILE.lock().unwrap() = Some(path);
            }

            // Build menu bar (shared function — also used by update_recent_menu)
            let menu = build_app_menu(app.handle(), None)
                .map_err(|e| e.to_string())?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if let Some(window) = app_handle.get_webview_window("main") {
                    // Handle quit — same as close, check for unsaved changes
                    if id == "quit" {
                        let _ = window.emit("check-close", ());
                        return;
                    }
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
        .on_window_event(|window, event| {
            // Close handling is scoped to the MAIN window. The secondary
            // presenter window (dual-screen / test mode) must close on its own
            // WITHOUT running the main window's unsaved-changes-then-quit flow —
            // otherwise closing the projector window quit the whole app. It also
            // must not close the shared DB.
            let is_main = window.label() == "main";
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if is_main {
                        // Ask the frontend if there are unsaved changes.
                        let _ = window.emit("check-close", ());
                        api.prevent_close();
                    } else {
                        // Presenter window closing → tell the main window to
                        // leave the dual-screen speaker view; let it close.
                        if let Some(main) = window.app_handle().get_webview_window("main") {
                            let _ = main.emit("presenter:closed", ());
                        }
                    }
                }
                tauri::WindowEvent::Destroyed if is_main => {
                    let _ = storage::close_db();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // macOS delivers double-click / "open with" as an Apple Event
            // surfaced here (no CLI arg; RunEvent::Opened is macOS-only).
            // Forward to the running window, or stash if the window isn't up
            // yet (frontend drains on boot via take_launch_file).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let path = urls.iter().find_map(|u| {
                    u.to_file_path().ok().and_then(|p| {
                        let s = p.to_string_lossy().into_owned();
                        s.ends_with(".eigendeck").then_some(s)
                    })
                });
                if let Some(path) = path {
                    if let Some(win) = _app_handle.get_webview_window("main") {
                        let _ = win.set_focus();
                        let _ = win.emit("open-file", path);
                    } else {
                        *PENDING_OPEN_FILE.lock().unwrap() = Some(path);
                    }
                }
            }
        });
}

#[cfg(test)]
mod launch_tests {
    use super::first_eigendeck_path;

    #[test]
    fn picks_existing_eigendeck_skips_flags_and_binary() {
        let deck = std::env::temp_dir().join(format!("fe-{}.eigendeck", std::process::id()));
        std::fs::write(&deck, b"x").unwrap();
        let d = deck.to_string_lossy().into_owned();
        // argv[0]=binary, a flag, a NON-existent deck, then the real one.
        let args = vec![
            "/usr/bin/eigendeck".to_string(),
            "--export".to_string(),
            "/nope/missing.eigendeck".to_string(),
            d.clone(),
        ];
        assert_eq!(first_eigendeck_path(&args), Some(d));
        // No deck arg -> None (skips argv[0], ignores flags).
        assert_eq!(
            first_eigendeck_path(&["bin".to_string(), "--debug".to_string()]),
            None
        );
        let _ = std::fs::remove_file(&deck);
    }
}
