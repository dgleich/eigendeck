# Eigendeck Design Decisions & Intentions

This document captures the reasoning behind non-obvious design choices. An LLM reading this should be able to understand *why* things work the way they do and recreate similar decisions.

## Text Editing

### Paste behavior
- **Cmd+V**: Rich paste — preserves formatting from clipboard
- **Cmd+Shift+V**: Plain text paste — strips all formatting, inserts raw text via `insertText` execCommand
- **Menu**: Edit > "Paste without Formatting" for discoverability
- **Intention**: Rich paste is default because slide text often comes from other formatted sources. But command-line output and code snippets need plain paste.

### Font size on pasted text
- When rich text is pasted, it may contain inline `<font size="...">` or `<span style="font-size:...">` tags
- The element's `fontSize` property (set in inspector) applies to the container div
- Inline font sizes in the HTML override the container — this is a CSS specificity issue
- **TODO**: When changing fontSize in the inspector, should also scale inline font sizes proportionally, or strip them if there's only one (meaning the user wants a uniform size)

### Keyboard shortcuts inside contentEditable
- `e.stopPropagation()` on the contentEditable div prevents regular keys from triggering slide shortcuts (Delete, Cmd+D duplicate, etc.)
- But `Cmd+key` combinations are NOT stopped — they bubble to the document-level handler
- The native `CmdOrCtrl+I` accelerator was removed from the Inspector menu to avoid macOS intercepting Cmd+I before JS sees it
- WebKit in Tauri does NOT handle Cmd+B/I natively in contentEditable — we must call `document.execCommand` explicitly

### Text format toolbar
- Portaled to `document.body` (not inside the scaled canvas) so buttons are normal size
- `onMouseDown={preventDefault}` on the wrapper prevents clicking toolbar from blurring the contentEditable
- Selection is saved continuously via `selectionchange` listener and restored before each `execCommand`
- All actions use `onClick` (not `onMouseDown`) — the wrapper's `preventDefault` keeps focus

### Auto-replace
- Two-stage: `--` → en-dash (–), then `–>` → arrow (→)
- Only triggers on the completing character (`>`, `-`, `=`)
- Full set: `-->` → →, `<--` → ←, `<->` → ↔, `=>` → ⇒, `<=>` → ⇔, `---` → —

## Drag and Selection

### 4px dead zone
- Drag only starts after 4px of mouse movement
- Prevents micro-drags during double-click (which was the root cause of double-click-to-edit being unreliable)
- Also prevents the element from shifting when moving the mouse toward toolbar buttons

### Copy/paste position
- Tracks `fromSlideIndex` when copying elements
- Pasting on the SAME slide: offsets +40px to avoid stacking
- Pasting on a DIFFERENT slide: preserves exact original position

## Themes

### 4 built-in themes
- **White**: #fff bg, #222 text (default, backward-compatible with `theme: 'white'` in saved files)
- **Light**: #f5f0e8 bg (ecru/warm), #2c2418 text
- **Dark**: #1a1a2e bg, #e8e8e8 text
- **Black**: #000 bg, #fff text

### Color resolution order
For text elements: `element.color` (explicit override) → `themeColorForPreset(theme, preset)` → hardcoded preset default

### Per-slide override
`Slide.theme?: string` — when absent, inherits from `Presentation.theme`. Set via inspector or right-click canvas.

### Theme definitions
Defined in `src/lib/themes.ts` — single file, easy to modify. Maps preset names to semantic color tokens: heading, text, accent, muted.

## SQLite Storage

### Hybrid in-memory/file
- App starts with an in-memory SQLite DB (`db_open_memory`)
- Images and demos can be added before first save
- First save uses SQLite backup API to copy memory → file, then reopens from file
- After save, incremental write-through to disk

### Write-through subscriber
- Zustand subscriber detects changes by diffing `prevPresentation` vs current
- Only dirty elements/slides get written (never full resync)
- `sqliteDbPath` is set to `null` during project load to prevent the subscriber from treating loaded data as "new"
- `prevPresentation` is reset after load so the subscriber doesn't diff against stale state

### Opening successive projects
- `openSqliteProject()` closes the previous DB (flush + checkpoint + db_close)
- Cancels pending flush timer
- Clears blob URL cache
- Then opens new DB

### Slide doubling bug (historical)
- Root cause: `sqliteDbPath` was set BEFORE `setPresentation()`, so the subscriber saw all loaded slides as "new additions" and re-inserted them
- Fix: disable subscriber during load, reset after

## Asset Loading

### Blob URL system
- All assets (images, demos) loaded from SQLite via `db_get_asset` → Blob → `URL.createObjectURL`
- Cached in `Map<path, blobUrl>` to avoid redundant loads
- `useDemoUrl(path, hash)` hook for demos, `useAssetUrl(path)` hook for images
- `invalidateAsset(path)` clears cache entry when demo is refreshed from disk

### Demo refresh
- Double-click demo overlay → interacting mode → "Refresh" button
- Reads HTML file from disk via `readFile`, stores in SQLite via `db_store_asset`
- Invalidates blob cache, increments `reloadKey` to force iframe remount

## HTML Export

### Centering
- Slides positioned with `top: 50%; left: 50%; transform: translate(-50%, -50%) scale(...)`
- No paddingTop hack — clean CSS centering on both axes

### Demo-piece communication
- BroadcastChannel replaced with postMessage relay in srcdoc iframes (opaque origins)
- Bootstrap script injected into each iframe: patches URLSearchParams, replaces BroadcastChannel
- Parent page has relay script forwarding messages to ALL iframes (channel keys prevent cross-slide interference)
- On slide navigation, parent sends `request-state` to re-trigger controller broadcasts

### Demo channel names
- Hardcoded per-demo filename (e.g., `'eigendeck-demo:harper_electron.html'`)
- NOT derived from `location.pathname` (empty in srcdoc)
- Bootstrap adds a per-slide prefix to prevent cross-slide collision

## UI

### Inspector structure (when no element selected)
- **Slide section**: Layout dropdown, Theme dropdown, Sync/Link controls
- **Presentation section**: Default theme, Author, Venue, LaTeX preamble

### Context menus
- Right-click canvas background → "Slide Properties" (opens inspector)
- Right-click element → cut/copy/paste, z-order, free/unlink, "Properties" (opens inspector)

### Close confirmation
- Rust `CloseRequested` handler prevents close and emits `check-close` event
- JS listener shows native dialog: "Unsaved changes. Close without saving?"
- Clean close (not dirty) proceeds directly via `window.destroy()`

### Sync badge visibility
- Only shown when the sync partner element still exists somewhere in the presentation
- Scans all slides to check — fast enough for typical deck sizes (< 1ms for 500 elements)

## Native Menu

### Single menu definition
- `build_app_menu()` function in lib.rs, shared by `setup()` and `update_recent_menu()`
- No duplicate menu code

### Accelerator conflicts
- `Cmd+I` has NO native accelerator (handled in JS: italic in contentEditable, inspector otherwise)
- `Cmd+E` for center text (no native accelerator)
- `Cmd+Shift+E` for Export to HTML
- `Cmd+Shift+V` handled in JS (paste plain text), menu item has no accelerator to avoid conflict
