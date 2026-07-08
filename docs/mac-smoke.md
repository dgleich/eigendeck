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
