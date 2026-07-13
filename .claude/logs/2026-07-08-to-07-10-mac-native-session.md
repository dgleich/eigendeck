# Native macOS shell: NSToolbar, document icon, startup polish (07-08 → 07-10)

Branch `feat/mac-native-shell`, **merged to main `057710a` (07-09)**; follow-up
config + fixes landed directly on main through 07-10. Goal: make Eigendeck feel
like a real Mac app without breaking Linux/Windows — native bits behind
`#[cfg(target_os = "macos")]`, the HTML toolbar as the cross-platform fallback.
(Linux container can't compile AppKit, so the native code was authored here and
built/verified by the user on the Mac via `tools/mac-build.sh`.)

## Native NSToolbar (`src-tauri/src/mac_toolbar.rs`, objc2/AppKit)
- **Three-zone layout** — left action group / centered **editable presentation
  title** + window proxy icon (BBEdit-style) / right group + Export. Window title
  hidden; the toolbar owns identity.
- **Author/Venue fields** — two-way bound to the deck, vertically centered (a long
  fight: intrinsic-height constraints, custom centered cell, natural fitting
  height — see the commit run 07-08/09).
- **Icon-only + hover tooltips**; the duplicated HTML toolbar is hidden on native
  builds. `document.title` is now set centrally in App (the HTML toolbar used to
  own it, so on native the title stopped tracking the deck — review fix).
- **Compact-view toggle** (#125) — shrinks toolbar height (UnifiedCompact),
  smaller icons, keeps the label row via `displayMode`; rebuild items on toggle so
  labels return. Hidden on welcome/present.
- **Jupyter server-status icon** (#128) — mirrors the web `ServerStatusPill`,
  shown only when the deck actually uses Jupyter.
- **AppKit gotchas captured** in `docs/mac-native-toolbar.md`: delegate must be
  `MainThreadOnly`; `method_id` for object-returning delegate methods (no early
  return / no `?`); leak the delegate; run the proxy setup on the main thread.
- Made **`mac-toolbar` a default cargo feature** so normal builds get it;
  `--webview-toolbar` runtime env builds without the native toolbar for testing.
- Dropped the dead-end #126 right-click display-mode menu (couldn't reliably find
  `NSToolbarView`); parked for later.

## Insert bar → floating chip panel
- Reworked the full-width insert strip into a **floating chip panel that overlays
  the canvas** (absolute, zero layout height) so elements slide under the chips.
- Tuned the **slide-canvas bottom gap** (24 → 12 → 8 → matched to side padding)
  and tracked the insert-HUD height so it wraps to 2+ rows without overlapping the
  slide.

## Document icon + bundle (07-10)
- **`.eigendeck` document icon** — two-master artwork (proxy-scale small / mark-on-
  page large), pre-rendered iconset + `eigendeck-doc.icns`, wired via Info.plist
  document type. Bundle resources switched to **map form** so the icns lands flat
  at `Resources/eigendeck-doc.icns` where `CFBundleTypeIconFile` finds it (array
  form preserved the source path and hid it). Version → 26.7.9. Brand kit +
  inventory added under docs.

## Startup / window polish (07-10) — kill the launch flashes
- Create the window **hidden → restore saved bounds → show** (no launch-time
  position jump).
- **Gate the welcome screen on the launch-file check** so opening a deck doesn't
  flash the intro first; install the native toolbar hidden so it doesn't flash
  before the welcome screen.

## Review fixes on the merge (07-10, `20a3fd0` + `9073f6b`)
Dedupe the window-focus effect (DOM fallback into `windowFocus.ts`); add missing
`[]` deps to the insert-HUD ResizeObserver; tag `PREF_SYNC` with the origin
window so `setPreference`'s echo doesn't double-dispatch; central `document.title`;
guard the Jupyter push effect with `!nativeToolbar`; `invokeSafe` wrapper;
`deckKernels` dedup; toolbar caret guard.

## Notebook + modal bug fixes (07-10)
- **#123 overlay data-loss race** — force-flush notebook overlays on save + on
  clean-quit; deterministic e2e guard (overlay survives a save inside the debounce
  window).
- **#121** — trust-independent "Discard Changes" in the asset inspector.
- **#120** — Escape closes the video insert modal.
- **#124** — repeated Delete keeps removing slides + clear selection after delete.

## State
All on main. The native toolbar itself is Mac-verified by the user; the
cross-platform pieces (insert panel, startup gating, notebook fixes) are covered
by vitest + the e2e rig here.
