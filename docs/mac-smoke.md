# macOS native-shell smoke checklist

The native (`#[cfg(target_os = "macos")]`) parts of the Mac-assed work can't be
built or run in the Linux dev container — verify them on the Mac. Build with
`bash tools/mac-build.sh`, then walk the checklist.

Cross-platform Rust logic that DOES have automated coverage (runs under
`cargo test` on any OS): `set_window_document`'s `document_title` helper
(`window_document_tests`). Run: `cd src-tauri && cargo test --lib window_document`.

## A. Proxy icon + filename in the title bar (`set_window_document`)

1. Open a saved `.eigendeck`. The title bar shows the **file name** and a small
   **document icon** (proxy icon) to its left.
2. **⌘-click** (or click-hold) the title → a path popover appears; the deck's
   folder is in the chain. **Drag** the proxy icon to Finder / Mail → it drags
   the actual `.eigendeck` file.
3. Make an edit → the close button / title shows the **edited dot** (dirty). Save
   (⌘S) → the dot clears.
4. A brand-new unsaved deck shows **no** proxy icon (empty represented filename).
5. The title stays **centered** (unchanged).

_If the build errors on an objc2 signature (e.g. `setRepresentedFilename` /
`setTitle` / `setDocumentEdited` wanting `unsafe`), wrap that call in `unsafe {}`
— I mirrored the safe `setLevel` precedent but can't compile-check macOS here._

## B. Native NSToolbar (implemented; needs a Mac compile pass)

Now IMPLEMENTED behind the `mac-toolbar` cargo feature (off by default so it
can't break the normal build):
- `src-tauri/src/mac_toolbar.rs` — a `define_class!` `NSToolbarDelegate` (holds
  the `AppHandle` in an ivar); items `add-slide / add-build / present / save`
  with SF Symbols; each item's action emits a Rust→JS `toolbar:action` event.
  `install()` attaches an `NSToolbar` to the `main` window with
  `NSWindowToolbarStyle::Unified`. Called from `lib.rs` setup (feature-gated).
- Frontend bridge routes `toolbar:action` → `dispatchToolbarAction` → the same
  action as the HTML button (unit-tested by `toolbarActions.test.ts`).

**Build + iterate:** `bash tools/mac-build.sh --toolbar` (adds
`--features mac-toolbar`). I could NOT compile the objc2 here (no macOS compiler),
so **expect a small fix or two on the first Mac build** — the likely spots and how
to fix:
- objc2 `define_class!` / method attribute syntax, or a setter wanting `unsafe`.
- `NSImage::imageWithSystemSymbolName_accessibilityDescription`,
  `NSWindowToolbarStyle::Unified`, or `NSToolbarItem::setTarget` argument type
  (may need an `AnyObject` cast) — adjust to the exact objc2-app-kit 0.3 symbol.
- If the toolbar shows but doesn't share the titlebar, set the main window's
  `"titleBarStyle"` in `tauri.conf.json` (`Transparent`/`Overlay`) and re-run.

**Send me the first compile error** and I'll turn it around — the feature flag
means this never blocks building/testing everything else.

**Verify (once it builds):** the toolbar renders with native unified material;
clicking **Add Slide / Add Build / Present / Save** performs the action; the title
stays centered; the window resizes fine.

**Then (only after it's confirmed):** hide the `+ Slide` / `+ Build` HTML buttons
on macOS (`platform()==='macos'`) so they aren't duplicated; keep `+ Title/+ Body`
in the HTML toolbar per the original ask.
