// Filesystem commands that replace the frontend's JS `fs`-plugin usage, so the
// webview can drop the `fs` capability entirely (no ambient disk access for any
// injected script). Reads of asset bytes keep going through `resolve_and_read`
// (the gated realpath+size-cap read in lib.rs); this module adds the rest:
// writes, stat/exists, mkdir, read_dir, the trust-ledger persistence, and a
// notify-based file watcher that emits `fs-watch-event` to the frontend.
//
// Paths handed to write/stat/read_dir come from native dialogs or deck-relative
// resolution — user-chosen, not attacker-chosen. Nothing here canonicalizes or
// gates (that's `resolve_and_read`'s job for the security-sensitive byte reads);
// instead the write/stat/watch commands require the caller to be the MAIN editor
// window (`require_main`) — see the caller-authorization note below.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

// --- caller authorization ----------------------------------------------------
// These commands act on whatever path the caller passes, with NO canonicalization
// or trust check (that is `resolve_and_read`'s job for the security-sensitive byte
// reads, which stays open to every window because the presenter renders assets
// through it). Only the MAIN editor window has any legitimate reason to drive
// arbitrary-path writes/stat/watch — the presenter/settings/security windows never
// call them. Refusing from any other window means a stray or secondary webview
// label can't turn its IPC access into arbitrary-path disk I/O. (audit C-3)
//
// The filesystem logic lives in window-free `*_impl` helpers so the unit tests can
// exercise it without constructing a WebviewWindow; the `#[tauri::command]`
// wrappers add the guard.
fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(format!(
            "filesystem command not permitted from window '{}'",
            window.label()
        ))
    }
}

// --- writes ------------------------------------------------------------------
// No parent auto-create (mirrors the JS plugin: callers mkdir explicitly first).

fn write_file_impl(path: &str, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(window: WebviewWindow, path: String, data: Vec<u8>) -> Result<(), String> {
    require_main(&window)?;
    write_file_impl(&path, data)
}

fn write_text_file_impl(path: &str, text: String, append: Option<bool>) -> Result<(), String> {
    if append.unwrap_or(false) {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut f| f.write_all(text.as_bytes()))
            .map_err(|e| e.to_string())
    } else {
        std::fs::write(path, text).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn write_text_file(
    window: WebviewWindow,
    path: String,
    text: String,
    append: Option<bool>,
) -> Result<(), String> {
    require_main(&window)?;
    write_text_file_impl(&path, text, append)
}

fn make_dir_impl(path: &str) -> Result<(), String> {
    // Always recursive — every current caller passes { recursive: true }.
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn make_dir(window: WebviewWindow, path: String) -> Result<(), String> {
    require_main(&window)?;
    make_dir_impl(&path)
}

// --- stat / exists -----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatInfo {
    /// mtime in epoch milliseconds; the frontend does `new Date(mtimeMs)`.
    mtime_ms: Option<i64>,
    size: u64,
    is_file: bool,
    is_dir: bool,
}

fn path_stat_impl(path: &str) -> Result<StatInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    Ok(StatInfo {
        mtime_ms,
        size: meta.len(),
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
    })
}

#[tauri::command]
pub fn path_stat(window: WebviewWindow, path: String) -> Result<StatInfo, String> {
    require_main(&window)?;
    path_stat_impl(&path)
}

fn path_exists_impl(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

// Returns Result (not bare bool) so the guard can reject a non-main caller; the
// frontend's `invoke<boolean>` still resolves to the bool on Ok.
#[tauri::command]
pub fn path_exists(window: WebviewWindow, path: String) -> Result<bool, String> {
    require_main(&window)?;
    Ok(path_exists_impl(&path))
}

// --- read_dir (debug batch tools) --------------------------------------------

// Only the debug-only `read_dir` returns this, so it's compiled out of release too.
#[cfg(debug_assertions)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
}

// Debug-builds-only: arbitrary directory enumeration is dev/batch tooling (its sole
// caller is the debug `dirPicker`). `#[cfg(debug_assertions)]` compiles it OUT of a
// release build entirely — a shipped binary has no `read_dir` command at all — matching
// the rest of the debug subsystem, which is already debug-builds-only (lib.rs). The
// registration in lib.rs's `generate_handler!` is `#[cfg(debug_assertions)]` to match.
// (audit C-3)
#[cfg(debug_assertions)]
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    Ok(out)
}

// --- trust ledger persistence (was JS fs in trustStore.ts) -------------------

fn ledger_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("asset-trust-ledger.json"))
}

/// Read the trust ledger JSON. None on missing/unreadable — the frontend treats
/// that as an empty ledger (fail-safe: untrusted).
#[tauri::command]
pub fn read_trust_ledger(app: AppHandle) -> Option<String> {
    let p = ledger_path(&app).ok()?;
    std::fs::read_to_string(&p).ok()
}

/// Write the trust ledger JSON (creating the app-data dir). Errors propagate;
/// the frontend swallows them (best-effort, mirrors the old JS behavior).
#[tauri::command]
pub fn write_trust_ledger(app: AppHandle, json: String) -> Result<(), String> {
    let p = ledger_path(&app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

// --- file watcher (was JS fs-plugin `watch`) ---------------------------------
// One RecommendedWatcher per subscribed path, keyed by an incrementing id the
// frontend holds and passes back to unwatch_path. Each raw notify event emits a
// `fs-watch-event` {id, path}; the frontend's own COALESCE_MS window collapses
// the burst a single save produces (same as before — the JS `delayMs` never
// truly coalesced either).

#[derive(Default)]
pub struct WatchState {
    next_id: u32,
    watchers: HashMap<u32, RecommendedWatcher>,
}

#[tauri::command]
pub fn watch_path(
    window: WebviewWindow,
    app: AppHandle,
    state: State<Mutex<WatchState>>,
    path: String,
) -> Result<u32, String> {
    require_main(&window)?;
    let id = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        let id = s.next_id;
        s.next_id = s.next_id.wrapping_add(1);
        id
    };
    let app_for_event = app.clone();
    let path_for_event = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = app_for_event.emit(
                "fs-watch-event",
                serde_json::json!({ "id": id, "path": path_for_event }),
            );
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    state
        .lock()
        .map_err(|e| e.to_string())?
        .watchers
        .insert(id, watcher);
    Ok(id)
}

#[tauri::command]
pub fn unwatch_path(state: State<Mutex<WatchState>>, id: u32) {
    // Dropping the watcher stops it.
    if let Ok(mut s) = state.lock() {
        s.watchers.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("eigendeck-fscmds-{}-{}", std::process::id(), name))
    }

    #[test]
    fn write_then_stat_roundtrips() {
        let p = tmp("w.bin");
        let _ = std::fs::remove_file(&p);
        write_file_impl(&p.to_string_lossy(), vec![1, 2, 3, 4]).unwrap();
        let st = path_stat_impl(&p.to_string_lossy()).unwrap();
        assert_eq!(st.size, 4);
        assert!(st.is_file);
        assert!(!st.is_dir);
        assert!(st.mtime_ms.is_some());
        assert!(path_exists_impl(&p.to_string_lossy()));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn write_text_roundtrips() {
        let p = tmp("t.txt");
        let _ = std::fs::remove_file(&p);
        write_text_file_impl(&p.to_string_lossy(), "héllo".into(), None).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "héllo");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn stat_missing_errors_and_exists_false() {
        let p = tmp("nope.bin");
        let _ = std::fs::remove_file(&p);
        assert!(path_stat_impl(&p.to_string_lossy()).is_err());
        assert!(!path_exists_impl(&p.to_string_lossy()));
    }

    #[test]
    fn make_dir_recursive_and_read_dir() {
        let base = tmp("d");
        let _ = std::fs::remove_dir_all(&base);
        let nested = base.join("a/b");
        make_dir_impl(&nested.to_string_lossy()).unwrap();
        assert!(nested.is_dir());
        std::fs::write(nested.join("x.eigendeck"), b"x").unwrap();
        let entries = read_dir(nested.to_string_lossy().into_owned()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "x.eigendeck");
        assert!(!entries[0].is_dir);
        let _ = std::fs::remove_dir_all(&base);
    }
}
