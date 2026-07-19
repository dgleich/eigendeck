//! Debug-only surface area, gated behind the `--debug` CLI flag.
//!
//! HARD INVARIANT (per project policy): the only reads of the debug flag in
//! the entire codebase are inside THIS module and inside `src/debug/` on the
//! frontend. Nothing else may branch on it — no `if debug_enabled` sprinkled
//! through business code. To enforce this:
//!   - `parse_debug_flag()` is the ONLY place that touches `std::env::args`
//!     for the flag.
//!   - `DebugFlag` is the ONLY Tauri state carrying it.
//!   - `debug_enabled()` is the single command the frontend uses to gate
//!     `<DebugMenu />` mounting.
//!   - `attach_submenu_if_enabled()` is the only entry point lib.rs uses to
//!     conditionally append the Debug submenu; it returns `Ok(None)` when
//!     the flag is off, so lib.rs never sees the bool.
//!   - Every `debug_*` command self-gates with `require()` before doing
//!     anything (defense in depth — if the frontend somehow invoked one
//!     without `--debug`, it would refuse).
//!
//! The menu emits standard `menu-event` events with `debug-*` ids; the
//! frontend's `<DebugMenu />` filters on that prefix.

use tauri::menu::{MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, State, Wry};

/// Managed state: was the app launched with `--debug`?
pub struct DebugFlag(pub bool);

/// Detect the debug flag once at startup. THE ONLY env read for this flag.
///
/// Two paths:
///   - `--debug` in argv — works for the released binary launched from
///     terminal (`./Eigendeck.app/Contents/MacOS/Eigendeck --debug`).
///   - `EIGENDECK_DEBUG=1` env var — needed for `tauri dev`, because the
///     Tauri CLI's argv passthrough places args BEFORE cargo's `--`
///     separator, so they reach cargo (which rejects them) instead of the
///     binary. tools/mac-build.sh translates its own `--debug` arg into the env
///     var so the user only ever types `bash tools/mac-build.sh --debug`.
pub fn parse_debug_flag() -> bool {
    if std::env::args().any(|a| a == "--debug") {
        return true;
    }
    matches!(std::env::var("EIGENDECK_DEBUG").as_deref(), Ok(v) if !v.is_empty() && v != "0")
}

/// Frontend mount gate. Returns the flag value verbatim.
#[tauri::command]
pub fn debug_enabled(flag: State<'_, DebugFlag>) -> bool {
    flag.0
}

/// Self-gate helper for any future debug-only commands. Kept (with
/// `#[allow(dead_code)]`) so the documented defense-in-depth pattern is
/// already in place when the first such command is added.
#[allow(dead_code)]
fn require(flag: &DebugFlag) -> Result<(), String> {
    if flag.0 {
        Ok(())
    } else {
        Err("debug commands disabled (launch with --debug to enable)".into())
    }
}

/// Build the Debug submenu. Called from lib.rs::build_app_menu; returns
/// `Ok(None)` when the flag is off so lib.rs never has to read the bool.
pub fn attach_submenu_if_enabled(app: &AppHandle) -> Result<Option<Submenu<Wry>>, String> {
    let flag = app.state::<DebugFlag>();
    if !flag.0 {
        return Ok(None);
    }
    let batch_html = MenuItemBuilder::new("Batch HTML Export…")
        .id("debug-batch-html")
        .build(app)
        .map_err(|e| e.to_string())?;
    let batch_roundtrip = MenuItemBuilder::new("Batch Round-trip Save Test…")
        .id("debug-batch-roundtrip")
        .build(app)
        .map_err(|e| e.to_string())?;
    let batch_cache = MenuItemBuilder::new("Batch Math Cache Audit…")
        .id("debug-batch-cache-audit")
        .build(app)
        .map_err(|e| e.to_string())?;
    let batch_warm = MenuItemBuilder::new("Batch Warm Math Cache (write in place)…")
        .id("debug-batch-warm-cache")
        .build(app)
        .map_err(|e| e.to_string())?;
    let batch_strip = MenuItemBuilder::new("Batch Strip History (write in place)…")
        .id("debug-batch-strip-history")
        .build(app)
        .map_err(|e| e.to_string())?;
    let dump_pb = MenuItemBuilder::new("Dump Pasteboard Types")
        .id("dump-pasteboard")
        .build(app)
        .map_err(|e| e.to_string())?;
    let sub = SubmenuBuilder::new(app, "Debug")
        .item(&batch_html)
        .item(&batch_roundtrip)
        .item(&batch_cache)
        .separator()
        .item(&batch_warm)
        .item(&batch_strip)
        .separator()
        .item(&dump_pb)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(Some(sub))
}
