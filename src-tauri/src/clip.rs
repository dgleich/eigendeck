//! Copy/paste support for asset-bearing slide elements.
//!
//! Two channels, both cross-platform, with the asset BYTES kept in Rust (never
//! shuttled through JS):
//!
//!  1. **Internal clip** — a process-global the frontend uses to round-trip a
//!     copied element with FULL fidelity (element JSON + the asset bytes + the
//!     source deck id) across windows / presentations. This is what makes
//!     "copy an image in deck A, paste into deck B" carry the bytes: paste
//!     stores them into the DESTINATION deck, instead of leaving the pasted
//!     element pointing at an asset that only exists in deck A.
//!
//!  2. **System clipboard image** — `clip_copy_asset` also puts the real raster
//!     on the OS clipboard via `arboard` (cross-platform) so the element pastes
//!     into OTHER apps too; macOS additionally offers SVG under its native UTI.

use crate::storage;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;

struct InternalClip {
    /// Opaque-to-Rust JSON: the copied element + source metadata.
    payload: String,
    /// Raw asset bytes (image / svg source).
    bytes: Vec<u8>,
    mime: String,
    /// System-clipboard generation captured right after our copy. If the live
    /// generation later differs, something else was copied → this internal clip
    /// is STALE and must not win over the foreign clipboard content. -1 on
    /// platforms without a cheap generation counter (best-effort: treated fresh).
    generation: i64,
}

/// Lightweight view (no bytes) so a paste-time "is there a clip?" check is cheap.
#[derive(Clone, Serialize)]
pub struct InternalClipMeta {
    pub payload: String,
    pub mime: String,
    pub has_bytes: bool,
}

/// Result of pasting the internal clip's asset into the current deck.
#[derive(Clone, Serialize)]
pub struct PastedAsset {
    pub asset_id: String,
    pub payload: String,
    pub mime: String,
}

static INTERNAL_CLIP: Lazy<Mutex<Option<InternalClip>>> = Lazy::new(|| Mutex::new(None));

/// Copy an asset-bearing element: read the asset bytes from the open deck into
/// the internal clip (with the element JSON `payload`) AND put the real image on
/// the system clipboard for other apps. Bytes never cross to JS.
#[tauri::command]
pub fn clip_copy_asset(
    app: tauri::AppHandle,
    asset_id: String,
    payload: String,
    mime: String,
) -> Result<(), String> {
    let bytes = storage::db_get_asset_bytes_by_id(asset_id)?;
    // System clipboard (best effort — must not block the internal round-trip).
    if let Err(e) = write_system_image(&app, &bytes, &mime) {
        eprintln!("[clip] system clipboard write failed: {e}");
    }
    // Capture the clipboard generation AFTER our write, so a later foreign copy
    // is detectable (peek returns stale).
    let generation = clipboard_generation(&app);
    let mut g = INTERNAL_CLIP.lock().map_err(|e| e.to_string())?;
    *g = Some(InternalClip { payload, bytes, mime, generation });
    Ok(())
}

#[tauri::command]
pub fn clip_peek_internal(app: tauri::AppHandle) -> Result<Option<InternalClipMeta>, String> {
    let live = clipboard_generation(&app);
    let mut g = INTERNAL_CLIP.lock().map_err(|e| e.to_string())?;
    if let Some(c) = g.as_ref() {
        // Stale: the system clipboard changed since our copy (a foreign app
        // copied something). Drop the internal clip so the foreign content wins.
        if c.generation >= 0 && live >= 0 && live != c.generation {
            *g = None;
            return Ok(None);
        }
    }
    Ok(g.as_ref().map(|c| InternalClipMeta {
        payload: c.payload.clone(),
        mime: c.mime.clone(),
        has_bytes: !c.bytes.is_empty(),
    }))
}

/// Paste the internal clip's asset INTO the current deck: store the bytes as a
/// new asset at `path` and return its fresh asset_id + the element payload.
/// None when the internal clip is empty / has no bytes.
#[tauri::command]
pub fn clip_paste_asset(path: String) -> Result<Option<PastedAsset>, String> {
    let (bytes, payload, mime) = {
        let g = INTERNAL_CLIP.lock().map_err(|e| e.to_string())?;
        match g.as_ref() {
            Some(c) if !c.bytes.is_empty() => (c.bytes.clone(), c.payload.clone(), c.mime.clone()),
            _ => return Ok(None),
        }
    };
    // Dedupe by content hash: pasting the same image repeatedly reuses one
    // asset instead of piling up identical copies in the deck.
    let asset_id = storage::store_asset_deduped(path, bytes, mime.clone())?;
    Ok(Some(PastedAsset { asset_id, payload, mime }))
}

/// Put rich text on the SYSTEM clipboard as text/html (+ a plain-text fallback)
/// so a text element pastes into other apps (Docs / Word / Slides / mail) as
/// formatted text. Cross-platform via arboard.
#[tauri::command]
pub fn clip_write_html(html: String, plain: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_html(html, Some(plain)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clip_clear_internal() -> Result<(), String> {
    let mut g = INTERNAL_CLIP.lock().map_err(|e| e.to_string())?;
    *g = None;
    Ok(())
}

/// The system clipboard's monotonic generation counter, so we can tell whether
/// the clipboard changed since our copy. macOS: NSPasteboard.changeCount.
/// Other platforms: -1 (no cheap counter; the internal clip is treated as fresh
/// — the rare "copied in eigendeck, then copied elsewhere, then pasted" case is
/// a macOS-correct, best-effort-elsewhere edge).
#[allow(unused_variables)]
fn clipboard_generation(app: &tauri::AppHandle) -> i64 {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel::<i64>();
        let _ = app.run_on_main_thread(move || {
            use objc2_app_kit::NSPasteboard;
            let pb = NSPasteboard::generalPasteboard();
            let _ = tx.send(pb.changeCount() as i64);
        });
        rx.recv().unwrap_or(-1)
    }
    #[cfg(not(target_os = "macos"))]
    {
        -1
    }
}

/// Put the element's asset on the SYSTEM clipboard. Raster → decoded to RGBA and
/// set via arboard (cross-platform). SVG → native UTI on macOS; no-op elsewhere
/// (the eigendeck round-trip still works through the internal clip).
fn write_system_image(_app: &tauri::AppHandle, bytes: &[u8], mime: &str) -> Result<(), String> {
    if mime == "image/svg+xml" {
        #[cfg(target_os = "macos")]
        {
            return mac_write_svg(_app, bytes);
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Ok(());
        }
    }
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("decode image for clipboard: {e}"))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: std::borrow::Cow::Owned(img.into_raw()),
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// macOS: offer the SVG under `public.svg-image` so vector apps receive the SVG.
#[cfg(target_os = "macos")]
fn mac_write_svg(app: &tauri::AppHandle, bytes: &[u8]) -> Result<(), String> {
    use std::sync::mpsc;
    let bytes = bytes.to_vec();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{NSData, NSString};
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let ty = NSString::from_str("public.svg-image");
        let data = NSData::with_bytes(&bytes);
        let ok = pb.setData_forType(Some(&data), &ty);
        let _ = tx.send(if ok { Ok(()) } else { Err("setData failed".into()) });
    });
    rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
}
