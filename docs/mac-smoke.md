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

## B. Native NSToolbar (to build together at the Mac)

The frontend half is done + tested: the app listens for a Rust→JS `toolbar:action`
event and routes `{id}` to the same action as the HTML toolbar button
(`src/lib/toolbarActions.ts` `dispatchToolbarAction`, unit-tested). The macOS
NSToolbar that *emits* those events needs a Mac to converge (a `define_class!`
`NSToolbarDelegate` is too intricate to author blind). Plan for the Mac session:

**Cargo:** add a `mac-toolbar` feature (off by default) so a broken spike can't
break the default build; add `NSToolbar` + `NSToolbarItem` to `objc2-app-kit`
features. **tauri.conf.json:** the main window may need `"titleBarStyle":
"Overlay"` (or transparent) so the toolbar shares the titlebar (unified material).

**New `src-tauri/src/mac_toolbar.rs`** (`#[cfg(all(target_os="macos",
feature="mac-toolbar"))]`), called from `lib.rs` setup for the `main` window:

1. `define_class!` an `NSToolbarDelegate` (super `NSObject`) that stores the
   `tauri::AppHandle` in an ivar. Implement:
   - `toolbarAllowedItemIdentifiers:` / `toolbarDefaultItemIdentifiers:` →
     `NSArray` of identifiers `["add-slide","add-build","present","save"]`.
   - `toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar:` → build an
     `NSToolbarItem`: set `label`, an SF Symbol `image`
     (`NSImage::imageWithSystemSymbolName`), `target = self`, `action =
     sel!(onItem:)`, and stash the id (e.g. via the item's `itemIdentifier`).
   - `onItem:` (custom method) → read the sender's `itemIdentifier`, then
     `app.emit("toolbar:action", ToolbarPayload { id })`.
2. Create `NSToolbar::initWithIdentifier`, set `delegate`, set
   `displayMode`/`setAllowsUserCustomization(false)`; get the `main` NSWindow
   (as in `set_window_above_menubar`), `setToolbar:` and (10.16+)
   `setToolbarStyle: .unified`. Retain the delegate (store it so it isn't
   dropped — an ivar on nothing lives; keep it in a `static`/`OnceCell` or in
   Tauri state).

**Then flip on the HTML side (only once the native toolbar is confirmed):** hide
the `+ Slide` / `+ Build` buttons on macOS (`platform()==='macos'`) so they're not
duplicated; keep `+ Title/+ Body` in the HTML toolbar per the original ask.

**Verify:** `bash tools/mac-build.sh` (with the feature:
`cargo build --features mac-toolbar` wired through, or a `tauri dev` variant),
then: the toolbar renders with native unified material; clicking **Add Slide /
Add Build / Present / Save** performs the action (the JS bridge is already proven
by `toolbarActions.test.ts`); the title stays centered; the window resizes fine.
