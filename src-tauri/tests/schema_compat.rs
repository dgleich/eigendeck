//! Schema-compat test for the committed example presentations.
//!
//! Walks `examples/*.eigendeck` in the repo root and verifies each
//! file opens cleanly under the CURRENT schema (`create_schema` runs
//! its idempotent CREATE-IF-NOT-EXISTS + the asset_id-migration code
//! path inline on open) and exports to JSON without error.
//!
//! Purpose: every time we change the SQLite schema or migration logic,
//! this test fails fast if any committed example deck can no longer be
//! loaded. Catches:
//!   - Migrations that drop or rename columns the committed files
//!     still rely on.
//!   - Migrations that throw on real-world data shapes (vs the
//!     synthetic shapes the unit tests cover).
//!   - JSON-export shape regressions for fields used by the editor
//!     or the LLM-EDITING contract.
//!
//! Run with: `cd src-tauri && cargo test --test schema_compat -- --nocapture`

use std::fs;
use std::path::{Path, PathBuf};

use eigendeck_lib::storage;

/// Copy each .eigendeck to a temp file before opening so SQLite's
/// WAL/SHM sidecars (`.eigendeck-shm`, `.eigendeck-wal`) don't get
/// dropped next to the repo source files. open_db sets WAL mode.
fn temp_copy(src: &Path, scratch_dir: &Path) -> PathBuf {
    let filename = src.file_name().expect("file_name");
    let dest = scratch_dir.join(filename);
    fs::copy(src, &dest)
        .unwrap_or_else(|e| panic!("copy {} → {}: {}", src.display(), dest.display(), e));
    dest
}

/// One file: open + export + minimal shape check. Returns Err with a
/// short reason on any failure so the outer test can aggregate them.
fn validate_one(path: &Path) -> Result<(), String> {
    let path_str = path.to_str().ok_or_else(|| "non-utf8 path".to_string())?;

    storage::open_db(path_str)
        .map_err(|e| format!("open_db: {}", e))?;

    let json = storage::db_export_json()
        .map_err(|e| format!("db_export_json: {}", e))?;

    let v: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("export JSON is not valid JSON: {}", e))?;

    // Shape sanity: top-level must be an object with a `slides` array.
    // (Don't assert specific slide contents — that drifts as users
    // edit. Just confirm the export-roundtrip didn't return garbage.)
    let obj = v.as_object().ok_or_else(|| "export root is not an object".to_string())?;
    let slides = obj.get("slides").ok_or_else(|| "export missing 'slides' key".to_string())?;
    if !slides.is_array() {
        return Err("'slides' is not a JSON array".to_string());
    }

    Ok(())
}

#[test]
fn all_committed_example_decks_load_under_current_schema() {
    // CARGO_MANIFEST_DIR is src-tauri/; examples/ is at the repo root.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().expect("repo root").to_path_buf();
    let examples_dir = repo_root.join("examples");

    if !examples_dir.exists() {
        panic!("examples/ not found at {}", examples_dir.display());
    }

    // Scratch dir under the system temp. PID-suffixed so concurrent
    // CI runs don't collide; cleared on success at the end.
    let scratch_dir = std::env::temp_dir().join(format!("eigendeck-schema-compat-{}", std::process::id()));
    fs::create_dir_all(&scratch_dir).expect("create scratch dir");

    let mut tested = 0;
    let mut failures: Vec<String> = Vec::new();

    let mut entries: Vec<_> = fs::read_dir(&examples_dir)
        .expect("read examples/")
        .filter_map(|r| r.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("eigendeck"))
        .collect();
    entries.sort_by_key(|e| e.path());

    for entry in entries {
        let src = entry.path();
        let filename = src.file_name().unwrap().to_string_lossy().to_string();
        let dest = temp_copy(&src, &scratch_dir);

        match validate_one(&dest) {
            Ok(()) => {
                println!("  ✓ {}", filename);
                tested += 1;
            }
            Err(e) => {
                println!("  ✗ {}: {}", filename, e);
                failures.push(format!("{}: {}", filename, e));
            }
        }
    }

    // Also validate specific committed test-presentation fixtures. NOT a glob:
    // test-presentations/ holds large regenerable artifacts (pdf-stress-test) we
    // don't want to load here — list the deck fixtures we DO commit explicitly.
    for rel in ["test-presentations/font-theme-matrix.eigendeck"] {
        let src = repo_root.join(rel);
        if !src.exists() { continue; }
        let filename = src.file_name().unwrap().to_string_lossy().to_string();
        let dest = temp_copy(&src, &scratch_dir);
        match validate_one(&dest) {
            Ok(()) => { println!("  ✓ {}", filename); tested += 1; }
            Err(e) => { println!("  ✗ {}: {}", filename, e); failures.push(format!("{}: {}", filename, e)); }
        }
    }

    // Cleanup (best-effort; OS will reap /tmp anyway).
    let _ = fs::remove_dir_all(&scratch_dir);

    assert!(tested + failures.len() > 0,
        "no .eigendeck files found in {}", examples_dir.display());
    assert!(failures.is_empty(),
        "{} of {} example decks failed schema compat:\n  - {}",
        failures.len(), tested + failures.len(), failures.join("\n  - "));

    println!("validated {} example .eigendeck files under current schema", tested);
}
