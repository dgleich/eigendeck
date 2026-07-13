use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
/// Returns (asset_filename, lib_path_inside_archive, output_filename).
///
/// bblanchon ships .tgz for every platform (including Windows — yes,
/// .tgz on Windows, not .zip). Per-platform dylib names:
///   - macOS:  bin/libpdfium.dylib  → libpdfium.dylib
///   - Linux:  lib/libpdfium.so     → libpdfium.so
///   - Win:    bin/pdfium.dll       → pdfium.dll
///
/// Note: bblanchon's mac builds put the dylib under lib/, the
/// others under bin/. Verified against the chromium/7763 release.
fn bblanchon_asset_for_target() -> Option<(&'static str, &'static str, &'static str)> {
    let os = env::var("CARGO_CFG_TARGET_OS").ok()?;
    let arch = env::var("CARGO_CFG_TARGET_ARCH").ok()?;
    match (os.as_str(), arch.as_str()) {
        ("macos",   "aarch64") => Some(("pdfium-mac-arm64.tgz",   "lib/libpdfium.dylib", "libpdfium.dylib")),
        ("macos",   "x86_64")  => Some(("pdfium-mac-x64.tgz",     "lib/libpdfium.dylib", "libpdfium.dylib")),
        ("linux",   "x86_64")  => Some(("pdfium-linux-x64.tgz",   "lib/libpdfium.so",    "libpdfium.so")),
        ("linux",   "aarch64") => Some(("pdfium-linux-arm64.tgz", "lib/libpdfium.so",    "libpdfium.so")),
        ("windows", "x86_64")  => Some(("pdfium-win-x64.tgz",     "bin/pdfium.dll",      "pdfium.dll")),
        ("windows", "aarch64") => Some(("pdfium-win-arm64.tgz",   "bin/pdfium.dll",      "pdfium.dll")),
        _ => None,
    }
}

fn download_and_extract_pdfium(
    archive_name: &str,
    lib_in_archive: &str,
    output_filename: &str,
    dest_dir: &PathBuf,
) {
    let dylib_dest = dest_dir.join(output_filename);
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

    // Fresh download → invalidate the macOS-prepared sentinel so the
    // xattr/codesign step runs once on the new bytes.
    let _ = fs::remove_file(dest_dir.join(".macos_prepared"));

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

/// macOS Gatekeeper kills processes that dlopen a quarantined dylib
/// (SIGKILL with no logged error). Network-downloaded files get the
/// com.apple.quarantine xattr; cargo / ureq downloads do too. Clear
/// xattrs, then re-sign ad-hoc so hardened runtime accepts the load.
///
/// Sentinel-gated: writes `.macos_prepared` after success so subsequent
/// builds skip. CRITICAL — `codesign --force` rewrites the file every
/// time, and Tauri's dev-mode watcher then fires "file changed →
/// rebuild" in an infinite loop. The sentinel makes this idempotent.
/// Re-download (tag bump) clears the sentinel so prep re-runs on the
/// fresh bytes.
fn ensure_dylib_loadable_on_macos(dylib_path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if !dylib_path.exists() {
            return;
        }
        let sentinel = dylib_path
            .parent()
            .unwrap()
            .join(".macos_prepared");
        if sentinel.exists() {
            return;
        }
        // Best-effort: don't fail the build if xattr/codesign aren't on
        // PATH. Both are part of macOS's command-line tools, so missing
        // them is unusual but not fatal.
        let _ = Command::new("xattr").args(["-c"]).arg(dylib_path).status();
        let _ = Command::new("codesign")
            .args(["--force", "--sign", "-"])
            .arg(dylib_path)
            .status();
        let _ = fs::write(&sentinel, "ok");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dylib_path;  // silence unused warning on non-Mac
    }
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // Stage pdfium dylib into src-tauri/resources/pdfium/ so tauri.conf.json
    // can bundle it via the "resources" field. Path is stable across
    // platforms; the dylib filename differs per OS — bblanchon_asset_for_target
    // returns the right one.
    if let Some((archive, lib_in_archive, output_filename)) = bblanchon_asset_for_target() {
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let dest_dir = manifest_dir.join("resources").join("pdfium");
        download_and_extract_pdfium(archive, lib_in_archive, output_filename, &dest_dir);
        // macOS-only: clear quarantine xattr + ad-hoc codesign so
        // Gatekeeper allows dlopen. No-op on other platforms.
        ensure_dylib_loadable_on_macos(&dest_dir.join(output_filename));
    } else {
        println!(
            "cargo:warning=no pdfium prebuilt configured for this target — \
             PDF rendering will be unavailable in this build"
        );
    }

    stage_llm_tools_docs();
    stage_llm_tools_skills();

    tauri_build::build()
}

/// Copy the 4 LLM docs from docs/ into src-tauri/resources/llm-tools/reference/
/// so they ship as bundled resources alongside the committed AGENTS.md (router) +
/// the assembled skills/ + demo-starter.html. The File → Install LLM Tools…
/// command writes the whole folder to a user-chosen location. The copies are
/// gitignored (generated duplicates). Missing sources are skipped, not fatal, so
/// the build keeps working in trees without the docs (e.g. partial checkouts).
fn stage_llm_tools_docs() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dest_dir = manifest_dir.join("resources").join("llm-tools").join("reference");
    if let Err(e) = fs::create_dir_all(&dest_dir) {
        println!("cargo:warning=could not create {}: {}", dest_dir.display(), e);
        return;
    }
    // Docs live in <repo root>/docs (repo root is the parent of src-tauri).
    let docs = manifest_dir
        .parent()
        .map(|p| p.join("docs"))
        .unwrap_or_else(|| manifest_dir.join("docs"));
    // Only the AUTHORING-facing docs ship in the kit — NOT the internal ones
    // (architecture, security, storage, build). SPEC.md is deliberately excluded:
    // it's a broad product spec (editor UI, keyboard, tech stack) whose useful part
    // (the element schema) LLM-EDITING.md already covers.
    for name in ["LLM-EDITING.md", "DEMO_AUTHORING.md", "DEMO_SPEC.md"] {
        let src = docs.join(name);
        // Re-stage when the source doc changes.
        println!("cargo:rerun-if-changed={}", src.display());
        if src.exists() {
            if let Err(e) = fs::copy(&src, dest_dir.join(name)) {
                println!("cargo:warning=could not copy {} into llm-tools: {}", name, e);
            }
        } else {
            println!("cargo:warning=llm-tools doc {} not found at {} — skipping", name, src.display());
        }
    }
}

/// Assemble the LLM-tools skill set: copy the CANONICAL committed skills from
/// <repo>/docs/skills/ into src-tauri/resources/llm-tools/skills/ so they bundle
/// with the app (skills are versioned WITH the app, not fetched). The staged copy
/// is gitignored (a generated duplicate of docs/skills/, which is the source of
/// truth; skills-public/ is the standalone published mirror). Missing source =
/// skipped, not fatal.
fn stage_llm_tools_skills() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = manifest_dir
        .parent()
        .map(|p| p.join("docs").join("skills"))
        .unwrap_or_else(|| manifest_dir.join("docs").join("skills"));
    println!("cargo:rerun-if-changed={}", src.display());
    if !src.exists() {
        println!("cargo:warning=docs/skills not found at {} — skipping skill staging", src.display());
        return;
    }
    let dest = manifest_dir.join("resources").join("llm-tools").join("skills");
    // Start clean so a removed/renamed skill doesn't linger in the staged copy.
    let _ = fs::remove_dir_all(&dest);
    if let Err(e) = copy_dir_recursive(&src, &dest) {
        println!("cargo:warning=could not stage docs/skills into llm-tools: {}", e);
    }
}

/// Recursively copy a directory tree (build-time helper).
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else if path.is_file() {
            fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}
