# Eigendeck — Presentation Software Specification

## Overview

Eigendeck is a desktop presentation tool built for academics and developers who need interactive JavaScript demos, LaTeX math, and precise visual control in their slides. It runs as a native app via Tauri on macOS, Linux, and Windows.

The core philosophy: **everything is a positioned element**. There is no fixed slide template. Every piece of content — titles, body text, annotations, images, arrows, demos — is a draggable, resizable element on a 1920×1080 canvas.

---

## Coordinate System

- Slide canvas: **1920 × 1080** (16:9)
- Origin: top-left (0, 0)
- All positions and sizes are in slide units
- The canvas is CSS-scaled to fit the screen — resolution-independent
- A 48px font at 1920×1080 looks the same on any display/projector

---

## Data Model

### File Format

A presentation is a directory:

```
my-presentation/
  presentation.json       # All slide data
  demos/                  # Self-contained HTML demos
  images/                 # Image files
  presentation.backup-*.json  # Auto-save backups (up to 20)
```

### presentation.json

```json
{
  "title": "Presentation Title",
  "theme": "white",
  "slides": [...],
  "config": {
    "transition": "slide",
    "backgroundTransition": "fade",
    "width": 1920,
    "height": 1080,
    "showSlideNumber": true,
    "author": "Author Name",
    "venue": "Conference 2026"
  }
}
```

### Slide

```json
{
  "id": "uuid",
  "layout": "default",
  "elements": [...],
  "notes": "Speaker notes text"
}
```

- `layout`: `"default"` | `"centered"` | `"two-column"`
- `elements`: ordered array — position in array = z-order (first = bottom)
- `notes`: plain text speaker notes

### Elements

All content on a slide is an element. Five types:

#### Text Element

```json
{
  "id": "uuid",
  "type": "text",
  "preset": "title",
  "html": "Content with <b>formatting</b> and $\\LaTeX$",
  "position": { "x": 80, "y": 40, "width": 1760, "height": 120 },
  "fontSize": 72,
  "fontFamily": "'PT Sans Narrow', sans-serif",
  "color": "#2563eb"
}
```

**Presets** (determine default styling):

| Preset       | Font Size | Font Family      | Weight | Style  | Color   | Purpose                        |
|-------------|-----------|------------------|--------|--------|---------|--------------------------------|
| `title`      | 72        | PT Sans          | bold   | normal | #222    | Slide titles                   |
| `body`       | 48        | PT Sans          | normal | normal | #222    | Main content                   |
| `textbox`    | 48        | PT Sans          | normal | normal | #222    | Freely positioned text         |
| `annotation` | 32        | PT Sans          | normal | italic | #2563eb | Small callouts, blue italic    |
| `footnote`   | 24        | PT Sans Narrow   | normal | normal | #888    | References, citations, grey    |

- `fontSize`, `fontFamily`, `color` are optional overrides
- `html` supports: `<b>`, `<i>`, `<u>`, `<br>`, `<span style="...">`, `<ul>/<li>`, `$...$` (LaTeX)
- Inline math: `$f(x) = x^2$` — rendered via MathJax SVG
- Display math: `$$\sum_{i=1}^n x_i$$` — centered block

#### Image Element

```json
{
  "id": "uuid",
  "type": "image",
  "src": "images/diagram.png",
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 }
}
```

- `src`: relative path from project directory, or `data:` URL (from clipboard paste)

#### Arrow Element

```json
{
  "id": "uuid",
  "type": "arrow",
  "x1": 400, "y1": 500,
  "x2": 800, "y2": 300,
  "position": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "color": "#e53e3e",
  "strokeWidth": 4,
  "headSize": 16
}
```

- Coordinates in slide space (1920×1080)
- `position` field required but not used (arrow uses x1/y1/x2/y2)
- Rendered as SVG with triangular arrowhead

#### Demo Element

```json
{
  "id": "uuid",
  "type": "demo",
  "src": "demos/bfs-demo.html",
  "position": { "x": 80, "y": 200, "width": 1760, "height": 700 }
}
```

- `src`: relative path to a self-contained HTML file
- Rendered in a sandboxed iframe
- Demo files must work standalone in a browser (inline CSS/JS or CDN)
- Reload button in editor to refresh after external edits

---

## Editor

### Layout

```
+------------------------------------------------------------------+
| [+ Slide] [Save]  |  Title  |  Author  Venue  [Export] [Present] |
+--------+-----+--------------------------------------------------+
|        |     |  [Layout▾] [H1][H2][H3] [B][I][List] [Size▾]     |
|        |     |  [Narrow][AA] [Color▾]                             |
| Slide  | ··· |  +------------------------------------------+      |
| thumb- |resize|  |                                          |      |
| nails  |handle|  |     Slide canvas (1920×1080 scaled)      |      |
|        |     |  |                                          |      |
| [1] *  |     |  +------------------------------------------+      |
| [2]    |     |  ▾ Speaker Notes                                   |
| [3]    |     +--------------------------------------------+------+
|        |     |  + Title  + Body  + Text  + Note  + Footnote      |
| [+Add] |     |  + Arrow  + Image  + Demo                  |Props |
+--------+-----+--------------------------------------------+------+
```

### Toolbar (top)

- **+ Slide**: add slide after current
- **Save**: save to project (Cmd+S)
- **Title**: double-click to edit presentation title
- **Author / Venue**: text fields, shown in slide footer
- **Export**: export to standalone HTML file
- **Present**: enter presentation mode (F5)

### Editor Toolbar (per-slide)

- **Layout**: Default, Centered, Two Column
- **Headings**: H1, H2, H3 (for body text preset)
- **Formatting**: Bold, Italic, Bullet List
- **Font Size**: 16–96px dropdown
- **Narrow**: toggle PT Sans Narrow
- **AA**: toggle uppercase + letter spacing
- **Color**: 14-color palette dropdown

### Text Formatting Toolbar (floating)

Appears above a text element when double-clicked to edit:
- Bold (Cmd+B), Italic (Cmd+I), Underline (Cmd+U)
- Font: PT Sans, PT Sans Narrow, Monospace
- Font size: 16–96px
- Color: 14-color palette
- Uppercase + letter spacing
- Bullet list
- Clear formatting

### Slide Sidebar (left)

- Thumbnail preview of each slide (scaled 1920→166px)
- Thumbnails render all element types
- Click to select slide
- Drag to reorder (pointer events, visual feedback)
- Duplicate (D) and Delete (X) buttons on hover
- Resizable via drag handle on right edge (150–400px)
- + Add Slide button at bottom

### Properties Panel (right, Cmd+I)

Contextual properties for selected object:

**Slide selected:**
- Layout dropdown
- Author / Venue fields

**Element selected:**
- Z-order: ⇊ ↓ ↑ ⇈ (bottom, down, up, top)
- Position: X, Y, W, H (numeric fields)
- Type-specific: font size (text), color/width/head size (arrow)

### Speaker Notes

- Collapsible panel below the canvas
- Plain text per slide
- Shown in speaker panel during presentation

---

## Presentation Mode

- **Fullscreen** custom renderer (no reveal.js)
- Renders slides identically to the editor — true WYSIWYG
- Canvas scaled to fit viewport, aspect ratio preserved
- Black background around slide

### Navigation

| Key | Action |
|-----|--------|
| → ↓ Space PageDown | Next slide |
| ← ↑ PageUp | Previous slide |
| Home | First slide |
| End | Last slide |
| S | Toggle speaker panel |
| Escape | Exit to editor |

### Speaker Panel

- Toggle with S key during presentation
- Shows: current slide notes, timer (start/pause/reset), next slide preview, slide count
- Dark panel at bottom of screen

---

## Export

- **Standalone HTML file** — no external dependencies (except Google Fonts CDN for PT Sans)
- Same rendering as editor and presenter
- Arrow key navigation
- Scale-to-fit viewport
- Demos inlined as `<iframe srcdoc="...">`
- All element types preserved with inline styles
- Author/venue footer and slide numbers

---

## Fonts

| Font | Usage | Bundled |
|------|-------|---------|
| PT Sans Regular/Bold/Italic | Default slide font | Yes (TTF in public/fonts/) |
| PT Sans Narrow Regular/Bold | Condensed text preset | Yes (TTF in public/fonts/) |
| System UI font stack | All UI elements | N/A (OS provides) |
| MathJax PT Sans math font | LaTeX math rendering | Separate build (public/mathjax/) |

---

## LaTeX Math

- Inline: `$...$` — rendered inline with text
- Display: `$$...$$` — centered block
- Custom MathJax build with PT Sans math font (x_height=0.500)
- Rendered as SVG (requires SRE-free MathJax build for Tauri)
- Currently falls back to browser MathML if SVG unavailable

---

## Auto-Save & History

- **Auto-save**: 3 seconds after last change (debounced)
- **Save on blur**: when window loses focus
- **Save before present**: force-save before entering presentation mode
- **Backup files**: `presentation.backup-{ISO-timestamp}.json`
- **Retention**: keeps last 20 backups, prunes older automatically
- **Skip**: doesn't save if JSON unchanged

---

## Undo/Redo

- **Cmd+Z**: undo
- **Cmd+Shift+Z** or **Ctrl+Y**: redo
- 100-step history
- **Batched**: drags (move/resize) create one undo entry per operation, not per pixel
- **Typing debounce**: 300ms idle before creating undo snapshot
- **Clear on file load**: opening a file resets undo history

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+S | Save |
| Cmd+N | New Project (via File menu) |
| Cmd+O | Open Project (via File menu) |
| Cmd+E | Export to HTML |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+I | Toggle Inspector/Properties panel |
| Cmd+Shift+D | Toggle Debug Console |
| F5 | Present |
| Delete/Backspace | Delete selected element |
| Escape | Exit present mode / stop editing text |
| Cmd+B | Bold (in text editing) |
| Cmd+I | Italic (in text editing) |
| Cmd+U | Underline (in text editing) |
| Cmd+V | Paste image from clipboard |

---

## Native Menu Bar (macOS)

- **Eigendeck**: About, Services, Hide/Show, Quit (Cmd+Q)
- **File**: New Project (Cmd+N), Open (Cmd+O), Save (Cmd+S), Export (Cmd+E), Close
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **View**: Present (F5), Speaker Notes, Inspector (Cmd+I), Debug Console (Cmd+Shift+D), Fullscreen
- **Window**: Minimize, Maximize, Close

---

## Element Interaction

### Adding Elements

Buttons in the editor actions bar:
- **+ Title**: title preset text element
- **+ Body**: body preset text element
- **+ Text**: generic text box
- **+ Note**: annotation (small, blue, italic)
- **+ Footnote**: footnote (small, grey, narrow)
- **+ Arrow**: red arrow with arrowhead
- **+ Image**: file picker (copies to images/)
- **+ Demo**: file picker for HTML demos

### Editing Elements

- **Click**: select element (shows in Properties panel)
- **Double-click text**: enter edit mode with floating format toolbar
- **Drag**: reposition (pointer events, pause undo during drag)
- **Resize handle**: bottom-right corner drag
- **Delete button**: red × on hover
- **Delete key**: delete selected element
- **Click canvas background**: deselect (select slide)

### Z-Order

- Array order = z-order (first element = bottom)
- Properties panel: ⇊ (bottom), ↓ (down), ↑ (up), ⇈ (top)

---

## Demo File Contract

Demo HTML files in `demos/` must be:
- **Self-contained**: all CSS/JS inline or via CDN
- **Standalone**: work when opened directly in a browser
- **Iframe-safe**: no `target="_top"` links
- **Responsive**: handle container sizing where possible

Example:
```html
<!DOCTYPE html>
<html>
<head>
  <style>body { margin: 0; font-family: sans-serif; }</style>
</head>
<body>
  <canvas id="c" width="800" height="400"></canvas>
  <script>
    // Interactive visualization code
  </script>
</body>
</html>
```

---

## LLM Editing

Presentations can be edited programmatically by modifying `presentation.json` directly. See [LLM-EDITING.md](LLM-EDITING.md) for the complete guide.

Key rules:
- Preserve existing element IDs
- Use UUIDs for new elements
- Use presets for text elements
- Array order = z-order
- Escape backslashes in LaTeX: `\\lambda` in JSON

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| App shell | Tauri v2 |
| Frontend | React + TypeScript + Vite |
| State management | Zustand + zundo (undo) |
| Math rendering | MathJax 4 (custom PT Sans font) |
| Fonts | PT Sans, PT Sans Narrow (bundled TTF) |

---

## Platform Support

| Platform | Status |
|----------|--------|
| macOS (ARM64) | Primary development target |
| macOS (x64) | CI builds |
| Linux (x64) | CI builds, dev container |
| Windows (x64) | CI builds |

---

## Slide Groups

Groups are consecutive slides that share the same slide number and move together.
Used for build animations, step-by-step demos, and linked object transitions.

### Data Model

```json
{
  "id": "uuid",
  "groupId": "shared-group-uuid",
  "layout": "default",
  "elements": [...],
  "notes": ""
}
```

- Slides with the same `groupId` form a group
- First slide in group = parent (shows number, full-size thumbnail)
- Subsequent slides = children (indented, slightly smaller in sidebar)
- `+ Build` button duplicates current slide into the same group

### Behavior

- **Numbering**: groups share one number (e.g., slides [A, B1, B2, C] show [1, 2, 2, 3])
- **Sidebar**: children indented 20px, scaled to 90%, slightly transparent
- **Move**: dragging parent moves entire group; dragging child moves just that slide
- **Present mode**: arrow keys step through all slides including children

---

## Debug Console

- Toggle: `Cmd+Shift+D` or View > Debug Console
- Captures `console.log/warn/error` + unhandled errors
- Inline panel at bottom of screen
- Keeps last 300 entries
- WebKit devtools auto-open in dev mode (`Cmd+Option+I`)

---

## Future / Planned

### Linked Objects (cross-slide animation)
- Elements can have a `linkId` shared across slides
- Duplicate slide within a group links all elements automatically
- Linked elements in different positions → animate transition
- New elements fade in, removed elements fade out
- Builds on slide groups system

### Multi-Select & Alignment
- Shift+click to select multiple elements
- Alignment tools: left, center, right, top, middle, bottom
- Distribute horizontally/vertically

### Per-Slide Transitions
- Fade, slide, zoom, none per slide
- Configurable in Properties panel

### Code Blocks
- Syntax-highlighted static code display
- Languages: Julia, Python, C, C++, Rust, Bash

### Custom CSS
- Per-presentation CSS injection for branding
- University/conference templates

### PDF Export
- Render each slide to PDF page

### MathJax Tilde Fix
- Tilde accent (`\tilde{x}`) positioned too high in PT Sans math font
- Fix requires adjusting glyph metrics (y-coordinate 732) in mathjax-ptsans-bundle font data

### Section Properties
- Per-section styling and configuration
- Sections group multiple slides with shared settings

### Tacky Elements
- Angled text boxes with hype fonts and fluorescent backgrounds
- Fun callout/highlight boxes for emphasis

### Table Editor
- Insert and edit tables within slides
- Row/column add/delete, cell merging

### Image Shading & Cropping
- Apply color overlays/tints to images
- Crop images within their element bounds

### Snap Guides & Alignment Lines
- Hidden alignment guides that appear when dragging elements
- Snap to edges, centers, and other elements
- Show/hide toggle in View menu + keyboard shortcut

---

## Architectural Decisions

Documenting key technical choices and why they were made.

### Why Not Reveal.js (removed at commit v0.1.0-revealjs)

Reveal.js was used initially for the presenter but caused constant problems:
- Theme CSS bled into the app UI (required `!important` overrides everywhere)
- Font sizes and text-transform didn't match editor WYSIWYG
- `window.open()` for speaker notes blocked by Tauri's WebKit
- Centered layout worked differently than our CSS
- We positioned elements absolutely, outside reveal.js's `<section>` model

**Decision**: Replace with custom presenter that renders slides identically to the editor.
Same CSS, same components, same coordinate system. CSS bundle dropped 74%.

### Why Not TipTap (removed at commit e0b70e1)

TipTap was used for the main body text editor, but:
- Only worked on one text area per slide
- Couldn't apply to positioned text boxes
- Large dependency (added ~400KB to JS bundle)
- Fighting between TipTap's undo and our store-level undo

**Decision**: Use native `contentEditable` with `document.execCommand` for formatting.
All text is now positioned elements with presets. JS bundle dropped 61%.

### ContentEditable Approach

Each text element is a single `<div>` that:
- Is always `contentEditable={editing}` (toggled on double-click)
- Uses `beforeinput` event to block edits when not in editing mode (abandoned — caused issues)
- Currently toggles contentEditable on double-click
- `suppressContentEditableWarning` silences React
- Floating toolbar portaled to `document.body` (outside the CSS-scaled canvas)

**Critical rule**: `applyMathLineStyles()` must NEVER set/clear `lineHeight`, `display`, etc. on the root contentEditable div. Only child `<div>` elements. Clearing root styles overwrites React's managed styles and causes a visible layout shift. (Found via git bisect — commit 85a473d introduced the bug.)

### Unified Elements Array

Every piece of content on a slide is a `SlideElement` in an ordered array:
- Array position = z-order (first = bottom, last = top)
- Single `SlideElementRenderer` handles all types
- `DraggableBox` wrapper provides drag/resize/delete for all non-arrow elements
- Arrow elements have their own renderer (SVG-based, no bounding box)

This replaced separate `title`, `textBoxes[]`, `arrows[]`, `image`, `demo` fields.
-1007 net lines removed in the refactor.

### MathJax Integration (complex — see section below)

### CSS Scale-to-Fit

The slide canvas is 1920×1080 and CSS-scaled to fit available space:
- Editor: `ResizeObserver` computes scale, applies via `transform: scale(s)` with `transformOrigin: top center`
- Presenter: wrapper div sized to `slideW * scale × slideH * scale`, inner slide scaled with `transformOrigin: top left`
- Thumbnails: same approach at ~0.086 scale
- All pointer coordinates divided by scale for slide-space positions

### Auto-Save Architecture (replaced by SQLite write-through)

Previously used JSON file auto-save with backup rotation. Now replaced by SQLite incremental write-through — every change is persisted to SQLite within 1 second, with proper temporal versioning.

### Undo/Redo (zundo)

- `temporal` middleware on Zustand store
- `partialize` tracks only `presentation` and `currentSlideIndex`
- `equality` check via `JSON.stringify` prevents duplicate snapshots
- `pauseUndo()` / `resumeUndo()` bracket continuous operations (drags, typing)
- `clear()` called on file load to reset history

### SQLite Storage (April 2026)

Replaced JSON directory format with a single `.eigendeck` SQLite file.

**Why SQLite over JSON directories:**
- Incremental saves (0.4ms vs rewriting entire file)
- Temporal versioning (unlimited undo history for free)
- Single file (no directory to manage, easy to share)
- Assets as BLOBs (images/demos stored inside the DB)
- Benchmarked: 400x faster than ZIP for incremental saves

**Why SQLite over ZIP:**
- ZIP requires full rewrite for any change (163ms for 50MB)
- SQLite incremental write: 0.4ms regardless of presentation size
- ZIP has no history capability

**Why WAL mode:**
- 48x faster writes than DELETE journal mode
- Sidecar files (-wal, -shm) cleaned up on close via PRAGMA wal_checkpoint(TRUNCATE)
- Rust `on_window_event(Destroyed)` ensures cleanup even on quit

**Data model — junction table for sync:**
- `elements` table: content + position (each element owns its data)
- `slide_elements` junction: which elements appear on which slides
- Sync = one element row, multiple slide_elements rows
- Editing a synced element is O(1) — one write, all slides see it
- Freeing a synced element = duplicate the element row, update the junction

**Incremental write-through (not full reimport):**
- Zustand is the interaction layer (fast, synchronous for UI)
- Subscriber diffs previous and current state after each change
- Only dirty items are written to SQLite (elements, slides, metadata)
- Structural changes (add/delete slide/element) tracked explicitly
- `db_import_json` is NEVER used in normal editing flow — only for initial creation and explicit compact
- This preserves temporal history (each edit = new version row)

**Why temporal versioning (valid_from/valid_to):**
- Every element change creates a new row with a timestamp
- Old version gets `valid_to` set, new version has `valid_to = NULL`
- History query: `WHERE valid_from <= T AND (valid_to IS NULL OR valid_to > T)`
- Exponential thinning for retention (keep recent, thin old)
- Compact command to delete history and VACUUM

**All SQLite code in Rust (`rusqlite`):**
- No WASM, no JavaScript SQLite
- Frontend calls Rust via Tauri `invoke()`
- CLI binary (`eigendeck-cli`) uses the same `eigendeck_lib::storage` module
- One storage implementation, two consumers (GUI + CLI)

### Demo Pieces — Controller/Viewport Iframes (April 2026)

Replaced the initial direct-DOM approach (v1) with iframe-based architecture (v2).

**Why not direct DOM (v1):**
- Demo JS running in the app context caused naming conflicts
- Complex lifecycle management (init, destroy, re-init on slide change)
- Required a custom demo loader to parse HTML and execute scripts

**Why controller/viewport iframes (v2):**
- Each piece is an iframe — sandboxed, isolated, no JS in app context
- Hidden controller iframe runs simulation/logic headlessly
- Viewport iframes render individual pieces
- Communication via `BroadcastChannel`
- Existing iframe infrastructure (DemoBox overlay/lock) just works
- Demo HTML serves all roles via URL hash (#role=controller, #piece=graph)

**BroadcastChannel naming in export:**
- In `srcdoc` iframes, `location.pathname` is empty
- All demos would collide on the same channel name
- Fix: inject a bootstrap script that overrides `BroadcastChannel` constructor
  to prefix every channel name with a unique per-slide-per-demo key

### Multi-Monitor Presenter (April 2026)

**Why not macOS fullscreen:**
- `setFullscreen` creates a new macOS Space and hides dock/menubar globally
- `setSimpleFullscreen` also hides menubar
- Both affect the primary display when presenting on secondary

**Solution (same as Keynote/PowerPoint):**
- Borderless window sized to cover the secondary monitor
- `NSWindow.setLevel_(25)` via cocoa crate (one above menu bar level 24)
- No fullscreen API involved — just a high window level
- Menu bar and dock on primary display stay untouched

**Display mirroring:**
- Auto-detects mirrored displays via `CGDisplayMirrorsDisplay`
- Disables mirroring before presenting (`CGConfigureDisplayMirrorOfDisplay`)
- Re-enables on presentation end
- Uses `ConfigureForSession` (not `ConfigurePermanently` — that prevented sleep)

### Shared Export Logic (April 2026)

**Why a shared module:**
- GUI export and CLI export were duplicated (~250 lines each)
- Bugs fixed in one weren't fixed in the other
- `src/lib/exportCore.mjs` is pure JS, no runtime dependencies

**Architecture:**
- `buildExportHtml(opts)` takes filesystem abstraction + optional math renderer
- GUI provides Tauri fs + in-app MathJax (pre-renders to SVG, offline)
- CLI provides Node fs + @mathjax/src (PT Sans font, pre-renders to SVG)
- Both produce identical output for non-math content

### HTML Entity Handling in MathJax (April 2026)

**Problem:** contentEditable stores `&` as `&amp;` in innerHTML. LaTeX table delimiters like `\bmat{0 & 1}` become `\bmat{0 &amp; 1}`, rendering "amp;" in output.

**Solution:** `unescapeHtml()` converts `&amp;` → `&`, `&nbsp;` → ` `, `&lt;` → `<`, etc. before passing tex to MathJax. Applied to both inline and display math extraction.

### Drag/Resize Over Iframes (April 2026)

**Problem:** During drag or resize, moving the pointer over an iframe causes the iframe to steal `pointermove` events. The drag becomes janky or stops.

**Solution:** Create a transparent full-screen blocker div on first `pointermove` (not on `pointerdown` — that would block double-click to edit text). Remove the blocker on `pointerup`. Same technique for both element drag and resize.

---

## MathJax Integration — Detailed Guide

### Overview

MathJax 4 with a custom PT Sans math font renders `$...$` (inline) and `$$...$$` (display) LaTeX as SVG.

### Build & Setup

The MathJax bundle lives in `mathjax-ptsans-bundle/` (committed to repo).

**To deploy**: copy the nosre build to public/:
```bash
cp mathjax-ptsans-bundle/tex-mml-svg-mathjax-ptsans-nosre.js public/mathjax/tex-mml-svg-mathjax-ptsans.js
```

**To rebuild** (from `mathjax-ptsans-bundle/build/`):
```bash
npx webpack --config webpack-nosre.config.cjs
```

The `-nosre` variant excludes the Speech Rule Engine which creates blob: Workers that Tauri blocks.

### Font Parameters

In `mathjax-ptsans-bundle/cjs/common.js`:
```js
x_height: .500  // = OS/2.sxHeight / head.unitsPerEm for PT Sans
```
This is the critical parameter for text/math size matching. Don't change `em_scale`.

### How Rendering Works (src/lib/mathjax.ts)

1. **Load**: MathJax script loaded on first math encounter (lazy)
2. **Config**: `fontCache: 'none'` (blob cache breaks in Tauri), `typeset: false` (manual control)
3. **Parse**: `renderMathInHtml()` walks the HTML string character by character
   - Skips HTML tags (`<...>`)
   - Finds `$$...$$` → display math
   - Finds `$...$` → inline math
4. **Convert**: `MJ.tex2svgPromise(`{${tex}}`, { display })` — note the **brace wrapping**
5. **Brace wrapping is critical**: without `{...}`, MathJax parses as multi-expression document and only returns the first expression
6. **texReset()** called before each conversion to clear parser state
7. **Timeout**: 2-second race against the promise (fallback to raw `$...$` on timeout)

### Tauri-Specific Workarounds

1. **Blob Worker stub**: MathJax's BrowserAdaptor creates a Worker via `new Worker(blobURL)`. Tauri blocks blob: URLs. We intercept `window.Worker` and return a fake that auto-replies to messages.

2. **fontCache: 'none'**: MathJax's SVG font cache creates blob: URLs for stylesheets. Disabled.

3. **Blob error suppression**: `window.addEventListener('error', ...)` catches and suppresses blob: errors.

4. **nosre build**: The Speech Rule Engine loads a web worker via blob: that hangs `tex2svgPromise`. The `-nosre` webpack config excludes SRE modules.

### WYSIWYG During Editing

- `$$` lines get `white-space: nowrap` during editing (prevents wrapping of raw LaTeX)
- Cached SVG heights set as `min-height` on `$$` lines for consistent line height
- Compact `⋯` placeholder shown while MathJax renders (prevents layout jump)
- `applyMathLineStyles()` runs on edit start, on every input, and after requestAnimationFrame
- Styles stripped from child elements before saving (never from root element!)

### Known Issues

- `\tilde{x}` accent — fixed in mathjax-ptsans-bundle update (April 2026)
- First MathJax render has a brief delay (script loading + first tex2svgPromise)
- fontCache: 'none' means SVG paths are duplicated (slightly larger HTML export)
- WebKit contentEditable: cursor appears left of list marker on empty new lines

---

## Development Workflow

### Local Development (Linux container on Mac)

```bash
# In the Colima/Docker container (/work is shared with Mac):
npm install
npm run tauri dev    # Won't work (no display) — use for build checks
npm run build        # TypeScript + Vite build
npm test             # Vitest unit tests
cargo check          # Rust check (in src-tauri/)
```

### macOS Testing

```bash
# Same directory as Linux container (shared via virtiofs):
npm install          # Reinstalls macOS-native node_modules
npm run tauri dev    # Opens native window with hot-reload
```

`node_modules/` is platform-specific — `npm install` when switching between Linux and Mac.

### MathJax Setup

```bash
cp mathjax-ptsans-bundle/tex-mml-svg-mathjax-ptsans-nosre.js public/mathjax/tex-mml-svg-mathjax-ptsans.js
```

### Git

- Remote: `git@github.com:dgleich/eigendeck.git`
- Config: David Gleich <david@dgleich.com>
- Tags: `v0.1.0-revealjs` (last reveal.js version)
- CI: GitHub Actions (TypeScript, Vite, cargo check, clippy)
- Release: push tags `v*` for multi-platform builds
