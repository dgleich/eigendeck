//! "Install LLM Tools" — writes a self-contained kit to a user-chosen folder
//! so AI coding agents (Claude Code, etc.) can edit `.eigendeck` decks and
//! author HTML demos.
//!
//! The kit is shipped as a bundled resource (`resources/llm-tools/`): the
//! committed AGENTS.md / CLAUDE.md / demo-starter.html, the distilled `skills/`
//! (the front door), and `reference/` — the 3 authoring docs build.rs copies
//! from docs/ (LLM-EDITING.md, DEMO_AUTHORING.md, DEMO_SPEC.md). The install
//! copies the kit tree RECURSIVELY (preserving `skills/`/`reference/` subdirs)
//! into `<target>/eigendeck-llm-tools/` and substitutes the real absolute path
//! to the app's `eigendeck-cli` for the `__EIGENDECK_CLI_PATH__` placeholder in
//! AGENTS.md.

use std::path::{Path, PathBuf};

use tauri::Manager;

/// Placeholder in the committed AGENTS.md, replaced at install time with the
/// resolved absolute path to the installed app's eigendeck-cli binary.
const CLI_PLACEHOLDER: &str = "__EIGENDECK_CLI_PATH__";

/// Locate the bundled `llm-tools` resource directory. Mirrors
/// `pdf.rs::resolve_pdfium_dylib`: `resource_dir()/resources/llm-tools`, with
/// a flat fallback for tauri-dev modes that don't prefix `resources/`.
///
/// A candidate must contain the NESTED structure (a `skills/` subdir), not merely
/// exist. Tauri's resource copy can FLATTEN a `**/*` glob (and never cleans the
/// destination, so stale files linger) — a flattened/stale kit has all files at the
/// top level and no `skills/`. Requiring `skills/` rejects such a kit so we fall back
/// to the nested source (dev) or fail loudly rather than install a broken, flattened
/// kit (#141).
fn resolve_kit_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir() failed: {}", e))?;

    let is_valid_kit = |p: &Path| p.join("skills").is_dir();

    let candidate = resource_dir.join("resources").join("llm-tools");
    if is_valid_kit(&candidate) {
        return Ok(candidate);
    }
    let flat = resource_dir.join("llm-tools");
    if is_valid_kit(&flat) {
        return Ok(flat);
    }
    // Dev fallback: the source tree (only present in `cargo tauri dev`).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("llm-tools");
    if is_valid_kit(&dev) {
        return Ok(dev);
    }

    Err(format!(
        "LLM tools kit not found (no valid nested kit with a skills/ subdir). \
         Checked: {}, {}, and {}. If a kit exists there but is flattened/stale, \
         rebuild after clearing the stale resource dir. The kit ships as a bundled \
         resource — installing only works in a correctly-built app.",
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
    // Refuse to overwrite: if the output already exists at all, stop before touching
    // anything. The user removes it (or picks another folder) deliberately.
    if out_dir.exists() {
        return Err(format!(
            "{} already exists — remove it (or choose another folder) first; \
             the installer will not overwrite an existing kit.",
            out_dir.display()
        ));
    }

    // Copy the whole kit tree — the kit has subdirs (skills/, reference/), so recurse.
    // AGENTS.md gets the CLI-path substitution; everything else is a straight copy.
    // copy_kit_tree refuses to overwrite any individual file (catches a mid-copy race);
    // on ANY failure we remove the partial output so a retry starts clean.
    if let Err(e) = copy_kit_tree(&kit_dir, &out_dir, &cli_str) {
        let _ = std::fs::remove_dir_all(&out_dir);
        return Err(e);
    }

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
            // Never overwrite: if the destination file already exists (e.g. it
            // appeared mid-copy), stop rather than clobber it.
            if dest.exists() {
                return Err(format!("Refusing to overwrite existing file: {}", dest.display()));
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("eigendeck-llmtools-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn copy_kit_tree_preserves_nested_structure_and_substitutes_cli() {
        let src = tmp("src1");
        fs::create_dir_all(src.join("skills").join("eigendeck")).unwrap();
        fs::write(src.join("AGENTS.md"), format!("cli={}", CLI_PLACEHOLDER)).unwrap();
        fs::write(src.join("skills").join("eigendeck").join("SKILL.md"), "skill").unwrap();
        let dst = tmp("dst1");
        copy_kit_tree(&src, &dst, "/abs/cli").unwrap();
        // Nested path preserved (not flattened) + CLI placeholder substituted.
        assert_eq!(fs::read_to_string(dst.join("AGENTS.md")).unwrap(), "cli=/abs/cli");
        assert_eq!(fs::read_to_string(dst.join("skills").join("eigendeck").join("SKILL.md")).unwrap(), "skill");
        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn copy_kit_tree_refuses_to_overwrite_an_existing_file() {
        let src = tmp("src2");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("x.md"), "new").unwrap();
        let dst = tmp("dst2");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("x.md"), "old").unwrap(); // pre-existing → must refuse
        let err = copy_kit_tree(&src, &dst, "cli").unwrap_err();
        assert!(err.contains("Refusing to overwrite"), "got: {err}");
        assert_eq!(fs::read_to_string(dst.join("x.md")).unwrap(), "old"); // untouched
        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dst).ok();
    }
}
