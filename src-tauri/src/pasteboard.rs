//! Native NSPasteboard access for Mac UTIs the webview filters out.
//!
//! WebKit's clipboardData / navigator.clipboard.read() only expose a
//! small allowlist of MIME types (text/plain, text/html, image/png).
//! Microsoft Office puts SVG on the clipboard as
//! com.microsoft.image-svg-xml; Adobe puts PDF as com.adobe.pdf;
//! Apple's own SVG UTI is public.svg-image. None of those reach JS.
//!
//! These two Tauri commands read the raw NSPasteboard via objc2-app-kit
//! so the paste handler can see and grab those formats. Linux/Windows
//! builds return empty/None — we only need this on macOS.
//!
//! Pasteboard access is dispatched to the main thread (objc2-app-kit
//! API requires MainThreadMarker) using the same Tauri
//! run_on_main_thread + mpsc::channel pattern as show_unsaved_dialog
//! in lib.rs.

/// List all UTIs currently on the general pasteboard. Empty Vec if
/// nothing's there. Used by the paste handler to decide whether to
/// fetch via this native path or fall through to the web clipboard.
#[tauri::command]
pub fn pasteboard_list_types(_app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<Result<Vec<String>, String>>();
        let _ = _app.run_on_main_thread(move || {
            let _ = tx.send(mac_pasteboard_list_types());
        });
        rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Read the raw bytes for a specific UTI from the general pasteboard.
/// Returns None if that UTI isn't present. Used immediately after
/// pasteboard_list_types when an interesting UTI is found.
#[tauri::command]
pub fn pasteboard_read_type(_app: tauri::AppHandle, uti: String) -> Result<Option<Vec<u8>>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<Result<Option<Vec<u8>>, String>>();
        let _ = _app.run_on_main_thread(move || {
            let _ = tx.send(mac_pasteboard_read_type(&uti));
        });
        rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = uti;
        Ok(None)
    }
}

// generalPasteboard() in objc2-app-kit 0.3 takes no MainThreadMarker
// (NSPasteboard read methods are thread-safe per Apple's docs). We still
// dispatch to the main thread via Tauri's run_on_main_thread above so
// behavior is predictable + consistent with the other AppKit calls in
// this codebase (NSAlert in lib.rs).

#[cfg(target_os = "macos")]
fn mac_pasteboard_list_types() -> Result<Vec<String>, String> {
    use objc2_app_kit::NSPasteboard;

    let pb = NSPasteboard::generalPasteboard();
    match unsafe { pb.types() } {
        Some(arr) => {
            let mut out = Vec::with_capacity(arr.len());
            for t in arr.iter() {
                out.push(t.to_string());
            }
            Ok(out)
        }
        None => Ok(Vec::new()),
    }
}

#[cfg(target_os = "macos")]
fn mac_pasteboard_read_type(uti: &str) -> Result<Option<Vec<u8>>, String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    let pb = NSPasteboard::generalPasteboard();
    let ns = NSString::from_str(uti);
    let data = unsafe { pb.dataForType(&ns) };
    Ok(data.map(|d| d.to_vec()))
}
