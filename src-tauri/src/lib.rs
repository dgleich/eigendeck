use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // macOS app menu
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
                .build()?;

            let new_item = MenuItemBuilder::new("New Project")
                .id("new-project")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::new("Open Project")
                .id("open-project")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::new("Save")
                .id("save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let export_item = MenuItemBuilder::new("Export to HTML")
                .id("export")
                .accelerator("CmdOrCtrl+E")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .item(&export_item)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let present_item = MenuItemBuilder::new("Present Mode")
                .id("present")
                .accelerator("F5")
                .build(app)?;
            let speaker_item = MenuItemBuilder::new("Toggle Speaker Notes")
                .id("speaker")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;

            let inspector_item = MenuItemBuilder::new("Toggle Inspector")
                .id("inspector")
                .accelerator("CmdOrCtrl+I")
                .build(app)?;

            let debug_item = MenuItemBuilder::new("Debug Console")
                .id("debug-console")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&present_item)
                .item(&speaker_item)
                .item(&inspector_item)
                .separator()
                .item(&debug_item)
                .separator()
                .fullscreen()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("menu-event", id);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
