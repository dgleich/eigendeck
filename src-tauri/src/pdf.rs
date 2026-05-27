// PDF rendering via pdfium-render.
//
// One Pdfium instance lives behind a OnceLock for the app's lifetime;
// dylib is loaded on first call from the Tauri resource bundle. With
// the `thread_safe` feature the bindings wrap themselves in a Mutex,
// so the shared instance can be hit from any Tauri command thread.
//
// Rendering: returns PNG bytes that the caller (frontend's renderAsset)
// drops straight into asset_cache. Aspect-fit into (max_width, max_height).

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::OnceLock;

use pdfium_render::prelude::*;
use tauri::Manager;

use crate::storage;

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

/// Locate the bundled pdfium dylib. In `cargo tauri dev` this resolves
/// to `src-tauri/resources/pdfium/libpdfium.dylib`; in a packaged .app
/// it lands inside `Contents/Resources/resources/pdfium/`.
///
/// Tauri's `path().resource_dir()` is the right anchor for both, with
/// per-platform filename branches (handled in build.rs for the download
/// half — the runtime filename is hard-coded here to match what we ship).
fn resolve_pdfium_dylib(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("resource_dir() failed: {}", e))?;

    // bundle.resources = ["resources/pdfium/*"] mirrors the on-disk
    // layout, so the relative path inside resource_dir matches.
    let filename = if cfg!(target_os = "windows") {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    };
    let candidate = resource_dir.join("resources").join("pdfium").join(filename);
    if candidate.exists() {
        return Ok(candidate);
    }

    // Fallback: some tauri-dev modes don't prefix `resources/` — check
    // the flat form too.
    let flat = resource_dir.join(filename);
    if flat.exists() {
        return Ok(flat);
    }

    Err(format!(
        "pdfium dylib not found. Checked: {} and {}. \
         Make sure build.rs ran (downloads bblanchon prebuilt).",
        candidate.display(), flat.display(),
    ))
}

fn get_pdfium(app: &tauri::AppHandle) -> Result<&'static Pdfium, String> {
    let init = PDFIUM.get_or_init(|| {
        let lib_path = resolve_pdfium_dylib(app)?;
        let bindings = Pdfium::bind_to_library(&lib_path)
            .map_err(|e| format!("Pdfium::bind_to_library({}) failed: {}", lib_path.display(), e))?;
        Ok(Pdfium::new(bindings))
    });
    init.as_ref().map_err(|e| e.clone())
}

/// Render one page of a stored PDF asset to PNG bytes, aspect-fit into
/// (max_width, max_height). `page` is 0-indexed.
///
/// Bytes come from `storage::db_get_asset_by_id` so this respects the
/// usual asset lifecycle (current version, no path lookup, watcher /
/// restore-aware). Caller (assetRenderer.ts) writes the result into
/// asset_cache under the assetId key.
#[tauri::command]
pub fn db_render_pdf_page(
    app: tauri::AppHandle,
    asset_id: String,
    page: u32,
    max_width: u32,
    max_height: u32,
) -> Result<Vec<u8>, String> {
    let pdfium = get_pdfium(&app)?;
    let bytes = storage::db_get_asset_by_id(asset_id.clone())?;

    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| format!("load_pdf_from_byte_slice for {}: {}", asset_id, e))?;

    let pdf_page = document.pages().get(page as PdfPageIndex)
        .map_err(|e| format!("page {} of {}: {}", page, asset_id, e))?;

    // scale_page_to_display_size: aspect-fit; never upscale past natural.
    let config = PdfRenderConfig::new()
        .scale_page_to_display_size(max_width as Pixels, max_height as Pixels);

    let bitmap = pdf_page.render_with_config(&config)
        .map_err(|e| format!("render page {} of {}: {}", page, asset_id, e))?;

    let dyn_image = bitmap.as_image()
        .map_err(|e| format!("bitmap.as_image() for {}: {}", asset_id, e))?;

    let mut png_bytes: Vec<u8> = Vec::new();
    dyn_image.write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| format!("encode png for {}: {}", asset_id, e))?;

    Ok(png_bytes)
}

/// Number of pages in a stored PDF asset. Cheap (parses header, doesn't
/// rasterize). Used by the inspector "page 1 of N" hint.
#[tauri::command]
pub fn db_pdf_page_count(
    app: tauri::AppHandle,
    asset_id: String,
) -> Result<u32, String> {
    let pdfium = get_pdfium(&app)?;
    let bytes = storage::db_get_asset_by_id(asset_id.clone())?;
    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| format!("load_pdf_from_byte_slice for {}: {}", asset_id, e))?;
    Ok(document.pages().len() as u32)
}
