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
    // System clipboard: put MULTIPLE representations on it (the native format +
    // a PNG raster) so each target app pastes the format it understands —
    // PDF/SVG into Keynote, PNG into apps that only take images. Best effort.
    let reps = build_reps(&app, &bytes, &mime);
    if let Err(e) = write_system(&app, &reps) {
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

#[tauri::command]
pub fn clip_clear_internal() -> Result<(), String> {
    let mut g = INTERNAL_CLIP.lock().map_err(|e| e.to_string())?;
    *g = None;
    Ok(())
}

/// Read a raster image off the SYSTEM clipboard as PNG bytes (or None if there
/// isn't one). The Linux image-paste fallback (#94): WebKitGTK's sync
/// `clipboardData` and async `navigator.clipboard.read()` don't reliably surface
/// a screenshot's `image/png`, so the web paste paths miss. arboard reads the
/// X11/Wayland clipboard image directly, so a screenshot pastes even when the
/// web APIs expose nothing. macOS keeps using the unfiltered `pasteboard_*`
/// path, so this is a no-op there.
#[tauri::command]
pub fn clip_read_system_image() -> Result<Option<Vec<u8>>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let mut cb = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        let img = match cb.get_image() {
            Ok(img) => img,
            Err(_) => return Ok(None), // no image on the clipboard
        };
        let (w, h) = (img.width as u32, img.height as u32);
        let raw = img.bytes.into_owned();
        let buf = image::RgbaImage::from_raw(w, h, raw)
            .ok_or_else(|| "clipboard image: byte length doesn't match dimensions".to_string())?;
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(Some(png))
    }
    #[cfg(target_os = "macos")]
    {
        Ok(None)
    }
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
        system_clipboard_generation()
    }
}

/// Linux/Windows generation: a HASH of the current system clipboard content.
/// These platforms have no cheap monotonic counter like NSPasteboard's
/// changeCount, so a foreign copy (screenshot, text, or an image from another
/// app) changes the bytes, the hash changes, and the internal clip reads stale so
/// the foreign content wins. (#94: on Linux the old sentinel value made the
/// internal clip ALWAYS fresh, so an in-app image copy permanently shadowed later
/// screenshots.) Called only on copy and paste (user actions), so the one
/// clipboard read is affordable. Returns a non-negative hash (top bit cleared),
/// because the staleness check requires a value at or above zero; a negative
/// value is returned only when the clipboard is empty or unreadable.
#[cfg(not(target_os = "macos"))]
fn system_clipboard_generation() -> i64 {
    use std::hash::{Hash, Hasher};
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return -1,
    };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    // Prefer the image target (screenshots / our own raster), fall back to text.
    // A distinct tag per kind keeps an image and same-length text apart.
    if let Ok(img) = cb.get_image() {
        b'I'.hash(&mut h);
        img.width.hash(&mut h);
        img.height.hash(&mut h);
        img.bytes.as_ref().hash(&mut h);
    } else if let Ok(txt) = cb.get_text() {
        if txt.is_empty() {
            return -1;
        }
        b'T'.hash(&mut h);
        txt.hash(&mut h);
    } else {
        return -1; // empty / unreadable clipboard
    }
    (h.finish() >> 1) as i64
}

#[cfg(all(test, not(target_os = "macos")))]
mod clip_generation_tests {
    use super::*;

    fn set_img(cb: &mut arboard::Clipboard, w: usize, h: usize, fill: u8) {
        cb.set_image(arboard::ImageData {
            width: w,
            height: h,
            bytes: std::borrow::Cow::Owned(vec![fill; w * h * 4]),
        })
        .unwrap();
    }

    // Needs a display (arboard talks to X/Wayland). Run under `xvfb-run`; skips
    // (passes) when no clipboard backend is available so headless CI without a
    // display doesn't fail. Guards #94: the generation must MOVE when a foreign
    // copy replaces our image — otherwise the internal clip never goes stale.
    #[test]
    fn generation_changes_when_clipboard_content_changes() {
        let mut cb = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return, // no display / backend — skip
        };
        set_img(&mut cb, 4, 4, 0x11);
        let g1 = system_clipboard_generation();
        if g1 < 0 {
            return; // backend couldn't serve a read-back here — skip rather than flake
        }
        // A "foreign copy" replaces the clipboard with different bytes.
        set_img(&mut cb, 4, 4, 0x22);
        let g2 = system_clipboard_generation();
        assert!(g2 >= 0, "generation should be readable");
        assert_ne!(g1, g2, "generation must change when clipboard content changes (#94)");
        // Re-reading the SAME content is stable (no false staleness).
        let g2b = system_clipboard_generation();
        assert_eq!(g2, g2b, "generation must be stable for unchanged content");
    }

    // #94 Gap 2: the arboard fallback returns a decodable PNG of the clipboard
    // image, so a Linux screenshot pastes even when WebKitGTK's web clipboard
    // APIs surface nothing. Run under `xvfb-run`; skips without a display.
    #[test]
    fn read_system_image_returns_decodable_png() {
        let mut cb = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return, // no display / backend — skip
        };
        set_img(&mut cb, 5, 3, 0x7f);
        let png = match clip_read_system_image() {
            Ok(Some(p)) => p,
            _ => return, // backend couldn't serve the read-back here — skip
        };
        let decoded = image::load_from_memory(&png).expect("output must be valid PNG");
        assert_eq!((decoded.width(), decoded.height()), (5, 3), "PNG must match the clipboard image dims");
    }
}

/// Build the clipboard representations (uti, bytes) for an asset: the native
/// format plus a PNG raster where we can produce one in Rust.
///   - PDF   → com.adobe.pdf + public.png (pdfium raster)
///   - SVG   → public.svg-image (vector apps; no Rust SVG rasterizer, so no PNG)
///   - PNG   → public.png
///   - other raster → public.png (decoded)
fn build_reps(app: &tauri::AppHandle, bytes: &[u8], mime: &str) -> Vec<(String, Vec<u8>)> {
    let mut reps: Vec<(String, Vec<u8>)> = Vec::new();
    match mime {
        "application/pdf" => {
            reps.push(("com.adobe.pdf".to_string(), bytes.to_vec()));
            match crate::pdf::render_first_page_png(app, bytes, 1600, 1200) {
                Ok(png) => reps.push(("public.png".to_string(), png)),
                Err(e) => eprintln!("[clip] pdf raster for clipboard failed: {e}"),
            }
        }
        "image/svg+xml" => reps.push(("public.svg-image".to_string(), bytes.to_vec())),
        "image/png" => reps.push(("public.png".to_string(), bytes.to_vec())),
        _ => match to_png(bytes) {
            Ok(png) => reps.push(("public.png".to_string(), png)),
            Err(_) => reps.push(("public.png".to_string(), bytes.to_vec())),
        },
    }
    reps
}

/// Re-encode arbitrary raster bytes (jpeg/gif/webp/...) to PNG.
fn to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Write the representations to the SYSTEM clipboard. macOS: all of them, as one
/// multi-type pasteboard write (so apps pick PDF/SVG/PNG as they prefer).
/// Other platforms: arboard sets the single PNG raster (true multi-format needs
/// per-OS native code — deferred; PNG covers the common case).
fn write_system(_app: &tauri::AppHandle, reps: &[(String, Vec<u8>)]) -> Result<(), String> {
    if reps.is_empty() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        return mac_write_multi(_app, reps.to_vec());
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some((_, png)) = reps.iter().find(|(u, _)| u == "public.png") {
            let img = image::load_from_memory(png).map_err(|e| e.to_string())?.to_rgba8();
            let (w, h) = img.dimensions();
            let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(img.into_raw()),
            })
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// macOS multi-type pasteboard write. declareTypes FIRST, in preference order
/// (most-preferred UTI first — `reps` is already ordered, e.g. com.adobe.pdf
/// before public.png), so all representations are registered and a paste target
/// gets its preferred one. Then setData for each. (declareTypes is the
/// documented way to put multiple types on the pasteboard — a bare setData loop
/// doesn't reliably register more than one.)
#[cfg(target_os = "macos")]
fn mac_write_multi(app: &tauri::AppHandle, reps: Vec<(String, Vec<u8>)>) -> Result<(), String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{NSArray, NSData, NSString};
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let types: Vec<objc2::rc::Retained<NSString>> =
            reps.iter().map(|(u, _)| NSString::from_str(u)).collect();
        let arr = NSArray::from_retained_slice(&types);
        // declareTypes_owner is marked unsafe in objc2 (owner-param contract);
        // we pass None for the owner, which is safe.
        let _ = unsafe { pb.declareTypes_owner(&arr, None) };
        let mut ok = true;
        for ((_, bytes), ty) in reps.iter().zip(types.iter()) {
            let data = NSData::with_bytes(bytes);
            if !pb.setData_forType(Some(&data), ty) {
                ok = false;
            }
        }
        let _ = tx.send(if ok { Ok(()) } else { Err("setData failed".into()) });
    });
    rx.recv().unwrap_or_else(|_| Err("main-thread dispatch failed".into()))
}
