//! "Install LLM Tools" — writes a self-contained kit to a user-chosen folder
//! so AI coding agents (Claude Code, etc.) can edit `.eigendeck` decks and
//! author HTML demos.
//!
//! The kit is shipped as a bundled resource (`resources/llm-tools/`): the
//! committed AGENTS.md / CLAUDE.md / demo-starter.html plus the 4 docs that
//! build.rs copies from docs/ (LLM-EDITING.md, SPEC.md,
//! DEMO_AUTHORING.md, DEMO_SPEC.md). The install copies every file into
//! `<target>/eigendeck-llm-tools/` and substitutes the real absolute path to
//! the app's `eigendeck-cli` for the `__EIGENDECK_CLI_PATH__` placeholder in
//! AGENTS.md.

use std::path::{Path, PathBuf};

use tauri::Manager;

/// Placeholder in the committed AGENTS.md, replaced at install time with the
/// resolved absolute path to the installed app's eigendeck-cli binary.
const CLI_PLACEHOLDER: &str = "__EIGENDECK_CLI_PATH__";

/// Locate the bundled `llm-tools` resource directory. Mirrors
/// `pdf.rs::resolve_pdfium_dylib`: `resource_dir()/resources/llm-tools`, with
/// a flat fallback for tauri-dev modes that don't prefix `resources/`.
fn resolve_kit_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir() failed: {}", e))?;

    let candidate = resource_dir.join("resources").join("llm-tools");
    if candidate.exists() {
        return Ok(candidate);
    }
    let flat = resource_dir.join("llm-tools");
    if flat.exists() {
        return Ok(flat);
    }
    // Dev fallback: the source tree (only present in `cargo tauri dev`).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("llm-tools");
    if dev.exists() {
        return Ok(dev);
    }

    Err(format!(
        "LLM tools kit not found. Checked: {}, {}, and {}. \
         The kit ships as a bundled resource — this only works in a packaged build.",
        candidate.display(),
        flat.display(),
        dev.display(),
    ))
}

/// Resolve the absolute path to the app's sibling `eigendeck-cli` binary.
/// In a packaged macOS app both binaries live in `Contents/MacOS/`; on
/// Windows/Linux the CLI sits next to the main executable.
fn resolve_cli_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe() failed: {}", e))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current_exe has no parent directory".to_string())?;
    let name = if cfg!(target_os = "windows") {
        "eigendeck-cli.exe"
    } else {
        "eigendeck-cli"
    };
    Ok(dir.join(name))
}

/// Install the LLM tools kit into `<target_dir>/eigendeck-llm-tools/`.
/// Returns the created directory path so the frontend can reveal it.
#[tauri::command]
pub fn install_llm_tools(app: tauri::AppHandle, target_dir: String) -> Result<String, String> {
    let target = Path::new(&target_dir);
    if !target.is_dir() {
        return Err(format!("Target folder does not exist: {}", target_dir));
    }

    let kit_dir = resolve_kit_dir(&app)?;
    let cli_path = resolve_cli_path()?;
    let cli_str = cli_path.to_string_lossy().to_string();

    let out_dir = target.join("eigendeck-llm-tools");
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Could not create {}: {}", out_dir.display(), e))?;

    // Copy the whole kit tree — the kit now has subdirs (skills/, reference/), so
    // recurse. AGENTS.md gets the CLI-path substitution; everything else is a
    // straight copy.
    copy_kit_tree(&kit_dir, &out_dir, &cli_str)?;

    Ok(out_dir.to_string_lossy().to_string())
}

/// Recursively copy `src` into `dst`, preserving the directory structure. The
/// top-level `AGENTS.md` has `__EIGENDECK_CLI_PATH__` replaced with the resolved
/// CLI path; all other files are copied verbatim.
fn copy_kit_tree(src: &Path, dst: &Path, cli_str: &str) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Could not create {}: {}", dst.display(), e))?;
    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Could not read {}: {}", src.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let dest = dst.join(&name);
        if path.is_dir() {
            copy_kit_tree(&path, &dest, cli_str)?;
        } else if path.is_file() {
            if name == "AGENTS.md" {
                let contents = std::fs::read_to_string(&path)
                    .map_err(|e| format!("Could not read {}: {}", path.display(), e))?;
                let contents = contents.replace(CLI_PLACEHOLDER, cli_str);
                std::fs::write(&dest, contents)
                    .map_err(|e| format!("Could not write {}: {}", dest.display(), e))?;
            } else {
                std::fs::copy(&path, &dest)
                    .map_err(|e| format!("Could not copy {} → {}: {}", path.display(), dest.display(), e))?;
            }
        }
    }
    Ok(())
}
