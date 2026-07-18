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

/// Same as pasteboard_list_types but reads the drag pasteboard (the
/// in-flight payload from a cross-app drag, e.g. dragging a shape out
/// of PowerPoint). macOS keeps drag data on a separate
/// NSPasteboardNameDrag from the regular clipboard; this is the only
/// way to see custom UTIs like com.microsoft.image-svg-xml during a
/// drop, since the webview's DataTransfer is filtered to standard
/// MIMEs (image/png etc.) just like clipboardData.
#[tauri::command]
pub fn pasteboard_list_drag_types(_app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<Result<Vec<String>, String>>();
        let _ = _app.run_on_main_thread(move || {
            let _ = tx.send(mac_pasteboard_list_drag_types());
        });
        rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Read raw bytes for a specific UTI from the drag pasteboard.
#[tauri::command]
pub fn pasteboard_read_drag_type(_app: tauri::AppHandle, uti: String) -> Result<Option<Vec<u8>>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<Result<Option<Vec<u8>>, String>>();
        let _ = _app.run_on_main_thread(move || {
            let _ = tx.send(mac_pasteboard_read_drag_type(&uti));
        });
        rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = uti;
        Ok(None)
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

/// DEBUG: dump every UTI currently on the general pasteboard with a byte length
/// and a text preview, to BOTH stdout (visible when the app is run from a
/// terminal in debug mode) and the returned string (logged in the JS console).
/// Used to diagnose which representations a source app offers so the paste
/// handler can pick the right one. macOS-only; a note elsewhere.
#[tauri::command]
pub fn pasteboard_dump(_app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<String>();
        let _ = _app.run_on_main_thread(move || {
            let _ = tx.send(mac_pasteboard_dump());
        });
        let report = rx
            .recv()
            .unwrap_or_else(|_| "pasteboard_dump: main-thread dispatch failed".into());
        // stdout (terminal debug run) — the leading marker makes it easy to grep.
        println!("[pasteboard_dump]\n{report}");
        Ok(report)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let msg = "pasteboard_dump: macOS-only (no NSPasteboard on this platform)".to_string();
        println!("[pasteboard_dump] {msg}");
        Ok(msg)
    }
}

// generalPasteboard() in objc2-app-kit 0.3 takes no MainThreadMarker
// (NSPasteboard read methods are thread-safe per Apple's docs). We still
// dispatch to the main thread via Tauri's run_on_main_thread above so
// behavior is predictable + consistent with the other AppKit calls in
// this codebase (NSAlert in lib.rs).

// objc2-app-kit 0.3 marks the NSPasteboard accessor / read methods we
// call below as SAFE — no `unsafe` blocks needed. Earlier I wrapped
// them defensively; clippy under -D warnings rejects the unused unsafe.

#[cfg(target_os = "macos")]
fn mac_pasteboard_list_types() -> Result<Vec<String>, String> {
    use objc2_app_kit::NSPasteboard;

    let pb = NSPasteboard::generalPasteboard();
    match pb.types() {
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
    let data = pb.dataForType(&ns);
    Ok(data.map(|d| d.to_vec()))
}

#[cfg(target_os = "macos")]
fn mac_pasteboard_dump() -> String {
    use objc2_app_kit::NSPasteboard;
    let pb = NSPasteboard::generalPasteboard();
    let mut lines = vec![String::from("=== general pasteboard types ===")];
    match pb.types() {
        Some(arr) => {
            for t in arr.iter() {
                let uti = t.to_string();
                let detail = match mac_pasteboard_read_type(&uti) {
                    Ok(Some(bytes)) => {
                        let len = bytes.len();
                        // Show a text preview for text-ish payloads; binary (png/tiff)
                        // just reports its length (the lossy preview would be noise).
                        let printable = bytes
                            .iter()
                            .take(64)
                            .filter(|&&b| b == b'\n' || b == b'\t' || (0x20..=0x7e).contains(&b))
                            .count();
                        if printable * 100 >= bytes.len().min(64) * 80 {
                            let text = String::from_utf8_lossy(&bytes);
                            let snippet: String = text.chars().take(300).collect();
                            format!("{len} bytes | {}", snippet.replace('\n', "\\n"))
                        } else {
                            format!("{len} bytes | <binary>")
                        }
                    }
                    Ok(None) => "no data".into(),
                    Err(e) => format!("read error: {e}"),
                };
                lines.push(format!("  {uti}\n      {detail}"));
            }
        }
        None => lines.push("  (no types)".into()),
    }
    lines.join("\n")
}

/// Apple's stable name string for the drag pasteboard. Used by
/// NSPasteboard::pasteboardWithName() to grab the drag-specific
/// pasteboard during/after a cross-app drop.
#[cfg(target_os = "macos")]
const NS_PASTEBOARD_NAME_DRAG: &str = "Apple CFPasteboard drag";

#[cfg(target_os = "macos")]
fn mac_pasteboard_list_drag_types() -> Result<Vec<String>, String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    let name = NSString::from_str(NS_PASTEBOARD_NAME_DRAG);
    let pb = NSPasteboard::pasteboardWithName(&name);
    match pb.types() {
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
fn mac_pasteboard_read_drag_type(uti: &str) -> Result<Option<Vec<u8>>, String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    let name = NSString::from_str(NS_PASTEBOARD_NAME_DRAG);
    let pb = NSPasteboard::pasteboardWithName(&name);
    let ns = NSString::from_str(uti);
    let data = pb.dataForType(&ns);
    Ok(data.map(|d| d.to_vec()))
}
