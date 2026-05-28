// PDF rendering via pdfium-render.
//
// One Pdfium instance lives behind a OnceLock for the app's lifetime;
// dylib is loaded on first call from the Tauri resource bundle. With
// the `thread_safe` feature the bindings wrap themselves in a Mutex,
// so the shared instance can be hit from any Tauri command thread.
//
// Rendering: returns PNG bytes that the caller (frontend's renderAsset)
// drops straight into asset_cache. Aspect-fit into (max_width, max_height).

use std::path::PathBuf;
use std::sync::OnceLock;

use pdfium_render::prelude::*;
use tauri::Manager;

use crate::storage;

// Per-step render timings. Flip to true while tuning the pipeline; off
// by default to keep the terminal clean for normal dev. Same pattern
// as the JS-side PASTE_LOG / RENDER_LOG consts.
const PDF_LOG: bool = false;
macro_rules! plog {
    ($($arg:tt)*) => { if PDF_LOG { eprintln!($($arg)*); } };
}

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

/// Pure render: given a Pdfium instance and PDF bytes, rasterize the
/// requested page to PNG bytes aspect-fit into (max_width, max_height).
/// Extracted from db_render_pdf_page so it can be tested without a
/// Tauri AppHandle (the smoke test below does exactly that).
fn render_page_inner(
    pdfium: &Pdfium,
    pdf_bytes: &[u8],
    page: u32,
    max_width: u32,
    max_height: u32,
) -> Result<Vec<u8>, String> {
    let t_load = std::time::Instant::now();
    let document = pdfium
        .load_pdf_from_byte_slice(pdf_bytes, None)
        .map_err(|e| format!("load_pdf_from_byte_slice: {}", e))?;
    plog!("[pdf] load_pdf_from_byte_slice ({}KB): {}ms",
        pdf_bytes.len() / 1024, t_load.elapsed().as_millis());

    let pdf_page = document.pages().get(page as PdfPageIndex)
        .map_err(|e| format!("page {} get: {}", page, e))?;

    // Aspect-fit into (max_width, max_height) WITHOUT auto-rotating
    // landscape pages — embedded slide images should keep their source
    // orientation. set_target_width + the two maximums together produce
    // "fit inside the box, never upscale past natural" without
    // scale_page_to_display_size's implicit 90° landscape rotation.
    //
    // Transparent clear color (alpha=0) preserves the PDF's actual
    // background. Default pdfium-render clears to opaque white, which
    // turns transparent-bg figure exports (Illustrator, Matplotlib,
    // Inkscape "save selection as PDF") into white-backgrounded blocks
    // on the slide. Pdfs with explicit white backgrounds still render
    // white — only the implicit fill changes.
    let config = PdfRenderConfig::new()
        .set_target_width(max_width as Pixels)
        .set_maximum_width(max_width as Pixels)
        .set_maximum_height(max_height as Pixels)
        .set_clear_color(PdfColor::new(0, 0, 0, 0));

    let t_render = std::time::Instant::now();
    let bitmap = pdf_page.render_with_config(&config)
        .map_err(|e| format!("render page {}: {}", page, e))?;
    plog!("[pdf] render_with_config ({}x{}): {}ms",
        max_width, max_height, t_render.elapsed().as_millis());

    // Skip the as_image() detour — pdfium already gives us RGBA bytes
    // directly. Going through DynamicImage adds a 14MB-class clone for
    // a 1920² page that we don't need.
    let t_bytes = std::time::Instant::now();
    let (w, h) = (bitmap.width() as u32, bitmap.height() as u32);
    let rgba = bitmap.as_rgba_bytes();
    plog!("[pdf] as_rgba_bytes ({}KB): {}ms",
        rgba.len() / 1024, t_bytes.elapsed().as_millis());

    // Default zlib compression. Fast-mode produced 10MB outputs (50x
    // bigger), which slowed the downstream SQLite write more than the
    // encoder saved. Default (level 6) is the right balance for rendered
    // PDF pages: ~200KB output, ~200ms encode at 1920².
    let t_png = std::time::Instant::now();
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::ImageEncoder;
        let encoder = PngEncoder::new_with_quality(
            &mut png_bytes,
            CompressionType::Default,
            FilterType::NoFilter,
        );
        encoder.write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
            .map_err(|e| format!("encode png: {}", e))?;
    }
    plog!("[pdf] encode_png ({}KB out): {}ms",
        png_bytes.len() / 1024, t_png.elapsed().as_millis());

    Ok(png_bytes)
}

/// Render one page of a stored PDF asset to PNG bytes, aspect-fit into
/// (max_width, max_height). `page` is 0-indexed.
///
/// Bytes come from `storage::db_get_asset_by_id` so this respects the
/// usual asset lifecycle (current version, no path lookup, watcher /
/// restore-aware). Caller (assetRenderer.ts) writes the result into
/// asset_cache under the assetId key.
// async fn + spawn_blocking — pdfium can take 40+ seconds on pathological
// PDFs (Form-XObject-heavy vector exports). Tauri 2 sync `pub fn` commands
// run on the WebView main thread, which blocks the compositor — even
// though JS keeps running (setTimeouts fire), the screen can't repaint,
// producing a beachball + queued visual updates. spawn_blocking moves
// the pdfium parse/render onto tokio's blocking thread pool, leaving the
// main thread free for paint commits and IPC dispatch.
#[tauri::command]
pub async fn db_render_pdf_page(
    app: tauri::AppHandle,
    asset_id: String,
    page: u32,
    max_width: u32,
    max_height: u32,
) -> Result<tauri::ipc::Response, String> {
    let png = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let t_total = std::time::Instant::now();
        plog!("[pdf] db_render_pdf_page asset={} page={} {}x{}",
            &asset_id[..8.min(asset_id.len())], page, max_width, max_height);

        let t_bind = std::time::Instant::now();
        let pdfium = get_pdfium(&app)?;
        plog!("[pdf] get_pdfium (bind): {}ms", t_bind.elapsed().as_millis());

        let t_fetch = std::time::Instant::now();
        let bytes = storage::db_get_asset_bytes_by_id(asset_id.clone())?;
        plog!("[pdf] db_get_asset_by_id ({}KB): {}ms",
            bytes.len() / 1024, t_fetch.elapsed().as_millis());

        let png = render_page_inner(pdfium, &bytes, page, max_width, max_height)
            .map_err(|e| format!("{}: {}", asset_id, e))?;
        plog!("[pdf] db_render_pdf_page TOTAL: {}ms ({}KB PNG)",
            t_total.elapsed().as_millis(), png.len() / 1024);
        Ok(png)
    })
    .await
    .map_err(|e| format!("spawn_blocking join: {}", e))??;
    Ok(tauri::ipc::Response::new(png))
}

/// Number of pages in a stored PDF asset. Cheap (parses header, doesn't
/// rasterize). Used by the inspector "page 1 of N" hint.
#[tauri::command]
pub fn db_pdf_page_count(
    app: tauri::AppHandle,
    asset_id: String,
) -> Result<u32, String> {
    let pdfium = get_pdfium(&app)?;
    let bytes = storage::db_get_asset_bytes_by_id(asset_id.clone())?;
    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| format!("load_pdf_from_byte_slice for {}: {}", asset_id, e))?;
    Ok(document.pages().len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Standard build.rs output location. Mac arm64 today; other targets
    /// added per the plan as separate commits.
    fn bundled_dylib_path() -> std::path::PathBuf {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let filename = if cfg!(target_os = "windows") {
            "pdfium.dll"
        } else if cfg!(target_os = "macos") {
            "libpdfium.dylib"
        } else {
            "libpdfium.so"
        };
        manifest_dir.join("resources").join("pdfium").join(filename)
    }

    /// End-to-end pdfium smoke test: bind the bundled dylib, generate a
    /// blank PDF in-process (no fixture file needed), run it through
    /// render_page_inner, assert non-empty PNG output with the magic
    /// header bytes.
    ///
    /// Gated `#[ignore]` because:
    /// 1. The pdfium dylib is platform-specific (Mac/Win/Linux), and
    ///    build.rs only downloads it for known targets.
    /// 2. CI/sandbox builds may not have the dylib at all.
    ///
    /// Run on Mac with:
    ///   cd src-tauri && cargo test --lib -- --ignored --test-threads=1
    #[test]
    #[ignore = "requires pdfium dylib at src-tauri/resources/pdfium/"]
    fn render_page_inner_emits_png_from_self_generated_pdf() {
        let dylib = bundled_dylib_path();
        assert!(
            dylib.exists(),
            "pdfium dylib not present at {} — run `cargo build` first to trigger build.rs download, or check that bblanchon supports this target",
            dylib.display(),
        );

        let bindings = Pdfium::bind_to_library(&dylib)
            .expect("bind_to_library");
        let pdfium = Pdfium::new(bindings);

        // Generate a tiny 1-page A4 PDF in-process so the test doesn't
        // need a binary fixture under version control.
        let pdf_bytes = {
            let mut doc = pdfium.create_new_pdf().expect("create_new_pdf");
            doc.pages_mut().create_page_at_end(
                pdfium_render::prelude::PdfPagePaperSize::a4(),
            ).expect("create_page_at_end");
            doc.save_to_bytes().expect("save_to_bytes")
        };
        assert!(pdf_bytes.len() > 100, "generated PDF should be non-trivial");

        let png = render_page_inner(&pdfium, &pdf_bytes, 0, 256, 256)
            .expect("render_page_inner");

        assert!(png.len() > 100, "rendered PNG should be non-trivial");
        // PNG file signature: 89 50 4E 47 0D 0A 1A 0A
        assert_eq!(
            &png[..8],
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            "output should start with PNG magic bytes",
        );
    }
}
