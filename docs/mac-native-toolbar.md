# Native macOS NSToolbar — implementation notes

Engineering notes for `src-tauri/src/mac_toolbar.rs` (the native `NSToolbar` on the
main window, behind the `mac-toolbar` cargo feature). Written after a long round of
AppKit/objc2 fights so we don't relearn them. Tool-neutral; see also
[`MAC-BUILD.md`](MAC-BUILD.md) and [`mac-smoke.md`](mac-smoke.md).

**Constraint that shapes everything:** the `#[cfg(target_os = "macos")]` +
`feature = "mac-toolbar"` code does **not** compile on the Linux dev container
(objc2-app-kit is a target-gated dep and isn't even fetched there). So `cargo
check` on Linux only validates `lib.rs`'s non-mac branches. The toolbar itself is
only ever compiled/tested on the Mac (`bash tools/mac-build.sh --toolbar`). Every
change here is "write carefully, the user compiles." That's why the gotchas below
were expensive.

## Architecture

- **Style:** `NSWindowToolbarStyle::Expanded` in normal mode — the native window
  title + proxy icon render centered on their own row (the BBEdit/Keynote look),
  toolbar items on the row below. Compact mode uses `UnifiedCompact` (short single
  row). The centered document title/proxy come free from `setRepresentedURL`
  (driven by `set_window_document` in `lib.rs`).
- **Delegate:** `ToolbarDelegate` (`define_class!`, `MainThreadOnly`) implements
  `NSToolbarDelegate`. `toolbar:itemForItemIdentifier:` (`item_for`) builds each
  item; `toolbarDefaultItemIdentifiers:` / `toolbarAllowedItemIdentifiers:` return
  the layout. The delegate + toolbar live in main-thread `thread_local`s (they're
  `!Send`); commands from JS hop via `window.run_on_main_thread`.
- **Items:** 5 SF-Symbol **buttons** (Add Slide / Add Build / Save / Export /
  Present) that post a Rust→JS `toolbar:action` event; editable **text fields**
  (title, Author, Venue) that post `toolbar:field`; a conditional **Jupyter**
  status item; and an invisible **lead-gap** spacer.
- **JS bridge:** buttons → `dispatchToolbarAction` (same as the HTML toolbar);
  fields ↔ store via `toolbar:field` / `set_toolbar_fields`; `native_toolbar_active`
  tells the frontend to hide the duplicated HTML toolbar row.

## Gotchas, in the order they bit us

### 1. Labels are `displayMode`, NOT the label string
The row of text under each icon is controlled by the toolbar's
`NSToolbarDisplayMode` (`IconAndLabel` vs `IconOnly`), not by whether items have
label strings. **`UnifiedCompact` forces `IconOnly` and does not restore
`IconAndLabel` when you switch back to `Expanded`** — so after a compact round-trip
the labels stayed gone (this was issue #125). Fix: set `displayMode` explicitly on
every mode change (`IconAndLabel` normal, `IconOnly` compact), and once at install.

### 2. `setBordered(true)` ⇒ icon-only
A bordered plain `NSToolbarItem` renders as a capsule button and drops its
label-beneath; a **borderless** item is the one that shows icon + label. So we keep
`setBordered(false)` always and drive icon-only via `displayMode`.

### 3. Compact toggle: restyle in place, do NOT rebuild
`set_compact` mutates the existing items (label/image/displayMode) + switches the
window toolbar style. We tried rebuilding the item set (`setItemIdentifiers`
empty→full) to force fresh items — it did rebuild, but labels *still* didn't come
back, because the real problem was #1 (displayMode), not stale items. In-place is
simpler and correct. `restyle_buttons` re-applies `style_button` to the cached
button items.

### 4. NSToolbar STRETCHES view-based items
When a custom-view item has no fixed size, NSToolbar adds its own constraints
tying the view to the row and **stretches it vertically to fill the row height**.
`NSTextField`'s default vertical content-hugging (750) loses that fight, so a
single-line field grows taller than its text and top-aligns → text rides high.
This masqueraded as a "centering bug" through several attempts. Fix: give each
field a **required height constraint = its `intrinsicContentSize().height`**
(set width via `widthAnchor`, `translatesAutoresizingMaskIntoConstraints = false`),
so the toolbar can't stretch it. Do this AFTER `setFont` so intrinsic height
reflects the font.

### 5. Vertically centering an NSTextField
`NSTextFieldCell` has **no** built-in vertical centering, and its
`intrinsicContentSize` is the padded control height (asymmetric insets), not the
glyph box — so "intrinsic height + centerY" centers the *box*, not the text.
- **Bezeled fields (Author/Venue):** at their intrinsic height they look right; no
  cell needed.
- **The title** is deliberately taller than its text (for focus-ring breathing
  room, `TITLE_VPAD`), so it needs a centering `NSTextFieldCell` subclass
  (`CenteredCell`). The correct recipe (classic "Jalkut"): measure text height with
  `cellSizeForBounds:` (guard re-entrancy — it calls back into
  `drawingRectForBounds:`) and shift the drawing rect down by half the surplus.
  **Wrong metrics we tried:** super's own `drawingRectForBounds:` height (barely
  moves → text high) and the font line box `ascender − descender + leading`
  (overshoots → text low). `cellSizeForBounds:` is the right one.
- **The edit jump:** overriding only `drawingRectForBounds:` centers display but
  the field editor lands elsewhere on click (text jumps). You must ALSO override
  `editWithFrame:…` and `selectWithFrame:…` to pass `[self drawingRectForBounds:]`
  to super, so editing uses the same centered rect.

### 6. Off-balance SF Symbols need a vertical nudge
`square.and.arrow.up` (Export) has weight above the box; `square.and.arrow.down`
(Save) below — so centering the whole glyph makes the box look off vs boxy
neighbors (Jupyter, Present). `nudge_image` composites the glyph onto a taller
transparent canvas (pad bottom = move up, pad top = move down) so the box reads
centered. Per-symbol, per-mode constants (`*_NUDGE_REGULAR/COMPACT`).

### 7. Conditional item = insert/remove, not hide
NSToolbarItems don't cleanly hide. The Jupyter status item is **allowed but not
default**; `set_jupyter` inserts it (before Export) when the deck uses a Jupyter
kernel and removes it otherwise — mirroring the HTML `ServerStatusPill`. Health
tint via `NSImageSymbolConfiguration` hierarchical color (systemGreen/Yellow/Red).

### 8. Right-click "Icon / Icon & Text" menu on the empty strip — shelved (#126)
There is **no public API** to attach a context menu to the toolbar's empty
background. `setMenu:` on views works only over the item views, not the gaps; the
`NSToolbarView` intercepts `menuForEvent:` so a menu set on it is ignored; the
stock display-mode menu drives `displayMode` which we bypass. The only route is
private `NSToolbarView` traversal, which is fragile. Left for the future.

### 9. Zero-width toolbar view item warns
A view item measured to 0 width/height logs
`"view was automatically measured but had an ambiguous height or width…"`. The
lead-gap spacer clamps its width to ≥ 1pt (`lead_gap_for`) so a "no gap" state
doesn't trip it.

## objc2 specifics worth remembering

- **`define_class!` init with ivars must go through super.** A class with
  `#[ivars = …]` produces a `PartialInit`; `msg_send![this, initTextCell: …]` fails
  the `RetainSemantics` bound. Use `msg_send![super(this), initTextCell: …]` (same
  as `ToolbarDelegate::new`'s `msg_send![super(this), init]`).
- **NSCell subclass ivars must be plain data.** `CellIvars { measuring: Cell<bool> }`
  is fine; do NOT put `Retained<_>` ivars in an NSCell subclass (AppKit may copy the
  cell).
- **NSColor system colors are `systemGreenColor()`, not `systemGreen()`.**
- **Struct-return + super overrides** (`drawingRectForBounds:` returning `NSRect`,
  the edit/select void overrides) go through raw `msg_send!`; there aren't always
  safe wrappers.
- **Unnecessary `unsafe`.** Many objc2-app-kit 0.3 calls we assumed were `unsafe`
  are safe (`setCell`, `widthAnchor`/`constraintEqualToConstant`/`setActive`,
  `intrinsicContentSize`, `lockFocus`/`drawAtPoint…`, `NSToolbar::validateVisibleItems`,
  the layout-anchor calls, `NSURL::fileURLWithPath`). CI/clippy flags the extra
  `unsafe` as `unused_unsafe`; drop them. The genuinely-unsafe ones are the
  `configurationWithPointSize…` symbol configs and the raw `msg_send!`s.
- **Constraint updates:** you can't `setFrameSize` a constraint-pinned view — keep
  the `Retained<NSLayoutConstraint>` and call `setConstant` (that's how
  `restyle_lead_gap` resizes the spacer per mode).
- **`lockFocus`/`unlockFocus` are deprecated** (resolution-independence) but fine
  for the tiny `nudge_image` composite; gate the function with
  `#[allow(deprecated)]`.

## Verifying

The Rust logic that has automated coverage is the cross-platform bits in `lib.rs`
(`document_title`); everything visual is the `mac-smoke.md` checklist on a Mac.
When something won't center/lay-out, the fastest debug is a one-run `eprintln!` of
the actual geometry (`intrinsicContentSize`, `cellSize`, `cellSizeForBounds:`,
super's `drawingRectForBounds:`, `isFlipped`) rather than guessing metrics.
