use std::env;
use std::fs;
use std::path::PathBuf;

// pdfium prebuilt release pinned here. MUST match the pdfium-render
// `pdfium_NNNN` API binding (default is `pdfium_latest` = whatever
// pdfium-render's current release names — see its README). Older
// bblanchon builds are missing newer pdfium symbols and pdfium-render
// fails at bind time with `dlsym: symbol not found`.
//
// pdfium-render 0.9.1 → pdfium_7763 → bblanchon tag `chromium/7763`.
// On bump: change the version below; the sentinel-file check next to
// the cached dylib forces a re-download so stale dylibs from the old
// tag don't poison the build.
//
// See: https://github.com/bblanchon/pdfium-binaries/releases
const PDFIUM_RELEASE_TAG: &str = "chromium/7763";

/// Resolve the bblanchon release-asset name for the build's target.
/// Returns (asset_filename, expected_dylib_path_inside_archive).
fn bblanchon_asset_for_target() -> Option<(&'static str, &'static str)> {
    let os = env::var("CARGO_CFG_TARGET_OS").ok()?;
    let arch = env::var("CARGO_CFG_TARGET_ARCH").ok()?;
    match (os.as_str(), arch.as_str()) {
        ("macos", "aarch64") => Some(("pdfium-mac-arm64.tgz", "lib/libpdfium.dylib")),
        ("macos", "x86_64") => Some(("pdfium-mac-x64.tgz", "lib/libpdfium.dylib")),
        // Windows + Linux follow as separate commits per the plan.
        _ => None,
    }
}

fn download_and_extract_pdfium(archive_name: &str, lib_in_archive: &str, dest_dir: &PathBuf) {
    let dylib_dest = dest_dir.join("libpdfium.dylib");
    // Sentinel: the release tag this dylib was extracted from. Mismatch
    // (tag bump in this file) forces re-download so the dylib stays in
    // lockstep with pdfium-render's expected symbol set.
    let tag_sentinel = dest_dir.join("RELEASE_TAG");
    let cached_tag = fs::read_to_string(&tag_sentinel).ok();
    let needs_download = !dylib_dest.exists()
        || cached_tag.as_deref().map(str::trim) != Some(PDFIUM_RELEASE_TAG);
    if !needs_download {
        return;
    }

    fs::create_dir_all(dest_dir).expect("create pdfium resources dir");

    let url = format!(
        "https://github.com/bblanchon/pdfium-binaries/releases/download/{}/{}",
        PDFIUM_RELEASE_TAG, archive_name,
    );
    println!("cargo:warning=downloading pdfium from {}", url);

    let resp = ureq::get(&url)
        .call()
        .unwrap_or_else(|e| panic!("pdfium download failed ({}): {}", url, e));
    let mut bytes: Vec<u8> = Vec::new();
    std::io::copy(&mut resp.into_reader(), &mut bytes)
        .expect("read pdfium archive into memory");

    // bblanchon ships .tgz for Mac/Linux.
    let gz = flate2::read::GzDecoder::new(&bytes[..]);
    let mut tar = tar::Archive::new(gz);
    let mut found = false;
    for entry in tar.entries().expect("read tar entries") {
        let mut entry = entry.expect("read tar entry");
        let path = entry.path().expect("entry path").to_path_buf();
        if path == std::path::Path::new(lib_in_archive) {
            let mut out = fs::File::create(&dylib_dest)
                .expect("create dylib output file");
            std::io::copy(&mut entry, &mut out).expect("extract dylib");
            found = true;
            break;
        }
    }
    if !found {
        panic!(
            "pdfium dylib not found at '{}' inside {}",
            lib_in_archive, archive_name,
        );
    }
    fs::write(&tag_sentinel, PDFIUM_RELEASE_TAG)
        .expect("write release-tag sentinel");
    println!("cargo:warning=pdfium dylib extracted to {} (tag={})", dylib_dest.display(), PDFIUM_RELEASE_TAG);
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // Stage pdfium dylib into src-tauri/resources/pdfium/ so tauri.conf.json
    // can bundle it via the "resources" field. Path is stable across
    // platforms; the dylib filename differs (libpdfium.dylib / .so / .dll)
    // — handled in the download step.
    if let Some((archive, lib_in_archive)) = bblanchon_asset_for_target() {
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let dest_dir = manifest_dir.join("resources").join("pdfium");
        download_and_extract_pdfium(archive, lib_in_archive, &dest_dir);
    } else {
        println!(
            "cargo:warning=no pdfium prebuilt configured for this target — \
             PDF rendering will be unavailable in this build"
        );
    }

    tauri_build::build()
}
