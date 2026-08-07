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

A presentation is a single **`.eigendeck` file** — a SQLite database holding all
slides, elements, assets (images/demos/notebooks/videos as BLOBs), and the full
temporal edit history. There is no directory to manage and nothing to zip; the one
file is what you share. (Historically a deck was a directory of `presentation.json`
+ `demos/` + `images/` + rotating JSON backups; that format was replaced by SQLite
in April 2026 — see *SQLite Storage* under Architectural Decisions.)

### Logical model

The shape below is the **logical** deck the CLI `export json` emits and `import
json` consumes (see LLM Editing). It is the conceptual model, not an on-disk file.

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

The `config` object carries more deck-wide settings than shown: default fonts
(`defaultTitleFont` / `defaultBodyFont` / `defaultHypeFont` / `defaultMonoFont` /
`footerFont`, font-package ids), the named type scale (`textSizes`), a custom color
palette (`customPalette`), a math macro string (`mathPreamble`), the notebook
kernel default (`notebookKernel`), asset auto-reload (`autoReloadAssets`), and a
`deckToken` identity used by the asset trust ledger. See `PresentationConfig` in
`src/types/presentation.ts` for the authoritative list.

### Slide

```json
{
  "id": "uuid",
  "elements": [...],
  "notes": "Speaker notes text",
  "groupId": "shared-group-uuid",
  "theme": "white",
  "titleFont": "lato",
  "bodyFont": "lato",
  "hypeFont": "shantell",
  "omitFooter": false
}
```

- `elements`: ordered array — position in array = z-order (first = bottom)
- `notes`: plain text speaker notes
- `groupId` (optional): slides sharing a `groupId` form a group (see Slide Groups)
- `theme` (optional): per-slide theme override; inherits `presentation.theme` if absent
- `titleFont` / `bodyFont` / `hypeFont` (optional): per-slide font-package overrides
  (ids from `src/lib/fonts.ts`); fall back to the deck `config.default*Font`, then to
  the default font (Lato, or Shantell for `hype`)
- `omitFooter` (optional): hide the author·venue + slide-number footer on this slide
  (title slides, dividers, full-bleed HTML); numbering keeps counting through it (#135)

> **No `layout` field.** Early versions had a per-slide `layout`
> (`default` / `centered` / `two-column`); layouts were removed — every element is
> freely positioned, so there is no template to switch.

### Elements

All content on a slide is an element. The `SlideElement` union has **nine** types:
**text**, **image**, **arrow**, **demo**, **demo-piece** (a positioned viewport of a
multi-piece demo), **cover** (an opaque masking rectangle), **notebook** (embedded
Jupyter/Pyodide), **video** (local file or YouTube/Vimeo/PeerTube embed), and **html**
(the raw-HTML escape hatch). The most common are detailed below; see
`src/types/presentation.ts` + `docs/LLM-EDITING.md` for the full schema of each.

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

| Preset       | Font Size | Font role        | Weight | Style  | Color   | Purpose                        |
|-------------|-----------|------------------|--------|--------|---------|--------------------------------|
| `title`      | 72        | title font       | bold   | normal | #222    | Slide titles                   |
| `body`       | 48        | body font        | normal | normal | #222    | Main content                   |
| `textbox`    | 48        | body font        | normal | normal | #222    | Freely positioned text         |
| `annotation` | 32        | body font        | normal | italic | #2563eb | Small callouts, blue italic    |
| `footnote`   | 24        | body font (narrow variant, if the font has one) | normal | normal | #888 | References, citations, grey |
| `hype`       | 48 (body) | hype font        | normal | normal | #1a1a1a | Sticky-note callout (seeded yellow bg + jaunty tilt) |

- Fonts follow the deck's title/body/hype font settings (per-deck `config.default{Title,Body}Font`, per-slide `Slide.{title,body,hype}Font`). The default is **Lato** for title/body and **Shantell** for hype (`DEFAULT_FONT_ID` / the `hype` fallback in `fontRegistry.mjs`). `footnote` uses the font's narrow variant when it defines one (e.g. PT Sans → PT Sans Narrow; Lato has none, so it stays Lato).
- `fontSize`, `fontFamily`, `color` are optional overrides
- Further optional style props (all absent = preset default): `fontSizeName` (named
  type-scale size), `verticalAlign`, `backgroundColor` + `backgroundOpacity`, `boxTint`
  (theme-relative "card" fill, #132), `borderRadius`, `padding` (per-side), `boxShadow`,
  `textEffect` (`shadow` / `glow`, #73), and `rotation`. See `TextElement` in
  `src/types/presentation.ts`.
- `html` supports: `<b>`, `<i>`, `<u>`, `<br>`, `<span style="...">`, `<ul>/<li>`, `$...$` (LaTeX)
- Inline math: `$f(x) = x^2$` — rendered via MathJax SVG
- Display math: `$$\sum_{i=1}^n x_i$$` — centered block

#### Image Element

```json
{
  "id": "uuid",
  "type": "image",
  "assetId": "asset-uuid",
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 }
}
```

- `assetId`: stable UUID binding to the stored asset — the image bytes live in the
  SQLite `assets` table and the display path is looked up from the asset, never stored
  on the element. There is no longer a `src`/`data:` field; legacy `src`-based elements
  are backfilled to `assetId` on load.
- `kind` (optional): `"raster"` (default) | `"svg"` | `"pdf"` — SVG/PDF sources are
  rasterized on demand into a cache
- Optional visual props: `shadow`, `borderRadius`, `opacity`, `rotation`

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
- Optional `heads` (`'end'` default | `'start'` | `'both'` | `'none'`) selects which ends
  get an arrowhead; `opacity` (0–1) sets stroke/fill opacity (#98)
- Rendered as SVG with triangular arrowhead
- Optional cubic-Bézier control points `c1x/c1y/c2x/c2y` (#129) curve the arrow when all four are present (Inkscape-style handles in the editor; heads orient to the curve tangent). Absent → straight line. Interior `points[]` add waypoints (Catmull-Rom, no handles).
- See **`docs/arrows.md`** for the full arrow spec: the cubic-Bézier-spline curve model (C¹, endpoint handles + Catmull-Rom interior), the endpoint-tangent-handle invariant, heads/inset, "+ Point", and editor interaction.

#### Demo Element

```json
{
  "id": "uuid",
  "type": "demo",
  "assetId": "asset-uuid",
  "position": { "x": 80, "y": 200, "width": 1760, "height": 700 }
}
```

- `assetId`: stable UUID binding to the stored demo HTML asset (bytes in the SQLite
  `assets` table, same model as images — no `src` path on the element)
- Rendered in a sandboxed, opaque-origin iframe (see `docs/DEMO-PLATFORM.md`)
- Demo files must work standalone in a browser (inline CSS/JS or CDN)
- Reload button in editor to refresh after external edits

#### HTML Element

```json
{
  "id": "uuid",
  "type": "html",
  "html": "<div style=\"…\">arbitrary markup</div>",
  "background": "#0b1020",
  "position": { "x": 560, "y": 340, "width": 800, "height": 400 }
}
```

- Raw-HTML escape hatch (#137) for custom design/layout — not text, not a demo.
- Rendered in a **locked sandboxed iframe**: no scripts run, and an injected CSP
  blocks all network (only `data:` URIs for images/fonts). The editor uses an
  `allow-same-origin` (still script-less) sandbox to enable best-effort in-place
  contentEditable; all other paths use a fully-locked sandbox.
- `background` optional (default transparent). Inserted from Insert → HTML Element.
- `interactive` (optional) lets the frame receive mouse events for script-less native
  interactivity (range/radio `:checked`/`:hover`). `scaleMode` (+ `scaleW`/`scaleH`)
  scales the content to fit the box (uniform contain, aspect preserved) so resizing
  grows/shrinks fixed-size markup instead of clipping it.
- See `docs/LLM-EDITING.md` for the authoring reference.

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
- **Author / Venue**: text fields, shown in slide footer. The footer font is a deck-level choice (`config.footerFont`, default Lato, in the Deck inspector), and any slide can hide its footer via the **Omit footer** checkbox (`slide.omitFooter`; numbering keeps counting through it). The footer renders identically across the editor, present, HTML export, and print/PDF paths via the shared `src/lib/footer.mjs` helper.
- **Export**: export to standalone HTML file
- **Present**: enter presentation mode (F5)

### Editor Toolbar (per-slide)

- **Headings**: H1, H2, H3 (for body text preset)
- **Formatting**: Bold, Italic, Bullet List
- **Font Size**: 16–96px dropdown
- **Narrow**: toggle PT Sans Narrow
- **AA**: toggle uppercase + letter spacing
- **Color**: 14-color palette dropdown

### Text Formatting Toolbar (floating)

Appears above a text element when double-clicked to edit:
- Bold (Cmd+B), Italic (Cmd+I), Underline (Cmd+U)
- Font: family picker (bundled families), narrow variant, monospace
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
- Theme + per-slide font overrides (title / body / hype)
- Omit-footer toggle
- (Deck-wide settings — default fonts, footer font, custom palette, type scale — live in
  the separate Deck inspector, not the per-slide panel)

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

Three export commands (File menu):

- **Export to HTML…** (Cmd+Shift+E) — a single **self-contained HTML file**:
  - Same rendering as editor and presenter; scale-to-fit viewport; arrow-key navigation
  - Fonts embedded as `@font-face` (no network; a PT Sans Google-Fonts `@import` remains
    only as a legacy fallback when no font CSS is supplied)
  - Demos inlined as `<iframe srcdoc="...">`; math pre-rendered to SVG
  - All element types preserved with inline styles; author/venue footer and slide numbers
- **Export Printable HTML…** (Cmd+Shift+P) — a paginated HTML file, one slide per page,
  for the browser's Print-to-PDF (#109)
- **Export to PDF (Screenshots)…** — rasterizes each slide and assembles a PDF

Live elements (demos, notebooks, videos) can be frozen to static images for print/PDF via
**Generate Missing Snapshots** / **Refresh All Snapshots** (File menu).

---

## Fonts

Eigendeck bundles **10 text font families** (all SIL OFL 1.1), each paired with a
matching MathJax math pack, plus **6 monospace code fonts** (no math) for notebook code
cells. The registry is `src/lib/fontRegistry.mjs`.

| Font | Usage | Bundled |
|------|-------|---------|
| Lato | **Default** title/body font (`DEFAULT_FONT_ID`) | Yes (public/fonts/) |
| Shantell | Default `hype` (sticky-note) font | Yes |
| PT Sans, Libertinus, Libertinus Sans, Computer Modern Sans, Noto Sans, Source Sans 3, Source Code Pro, Computer Modern Concrete | Other selectable text families | Yes |
| Fira Code, IBM Plex Mono, Inconsolata, JetBrains Mono, PT Mono, Computer Modern Typewriter | Monospace code fonts (notebooks) | Yes |
| System UI font stack | App UI chrome | N/A (OS provides) |
| Per-font MathJax math packs | LaTeX math rendering | Separate `-nosre` builds (public/mathjax/) |

Fonts are chosen per deck (`config.default{Title,Body,Hype,Mono}Font`, `config.footerFont`)
and can be overridden per slide (`Slide.{title,body,hype}Font`). The narrow variant of a
family (when it has one, e.g. PT Sans → PT Sans Narrow) is used for the `footnote` preset.

---

## LaTeX Math

- Inline: `$...$` — rendered inline with text
- Display: `$$...$$` — centered block
- Each text font has a matching custom MathJax math pack so math matches the surrounding
  text metrics (x-height tuned per font)
- Rendered as SVG (requires an SRE-free `-nosre` MathJax build for Tauri)
- `config.mathPreamble` lets a deck define custom `\newcommand` macros

---

## Auto-Save & History

Persistence is **SQLite incremental write-through** (April 2026), not JSON file
rotation. See *SQLite Storage* under Architectural Decisions for the full model.

- **Incremental save**: every change is diffed and written to the `.eigendeck` file within
  ~1 second (only dirty rows, ~0.4 ms) — no full-file rewrite
- **Temporal history**: each edit creates a new versioned row (`valid_from`/`valid_to`), so
  history is retained in-file rather than as separate backup files; browse it via the
  History panel (Cmd+Shift+H) or `eigendeck-cli … history`
- **Retention**: exponential thinning of old versions; `compact` deletes history and VACUUMs
- **WAL mode**: `-wal`/`-shm` sidecars are checkpointed and cleaned up on close

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
| Cmd+Shift+S | Save As |
| Cmd+N | New Project (via File menu) |
| Cmd+O | Open Project (via File menu) |
| Cmd+Shift+E | Export to HTML |
| Cmd+Shift+P | Export Printable HTML |
| Cmd+Shift+N | New Slide |
| Cmd+D | Duplicate Slide |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+I | Toggle Inspector/Properties panel |
| Cmd+Shift+H | Toggle History panel |
| Cmd+Shift+D | Toggle Debug Console |
| F5 | Present |
| Delete/Backspace | Delete selected element |
| Escape | Exit present mode / stop editing text |
| Cmd+B | Bold (in text editing) |
| Cmd+I | Italic (in text editing) |
| Cmd+U | Underline (in text editing) |
| Cmd+V | Paste image from clipboard |

---

## Native Menu Bar

The native menu bar is **platform-native** (macOS / Windows / Linux differ — app
menu, Settings vs Preferences, Quit vs Exit, About placement, Window menu). Full
structure, per-OS placement table, item ids, and how it's wired: **[`docs/menus.md`](menus.md)**.

---

## Element Interaction

### Adding Elements

From the editor's **Add** menu:
- **Add Title / Add Body / Add Text Box / Add Annotation / Add Footnote** — the text presets
- **Add Arrow** — arrow with arrowhead

Media elements are inserted by picking a file (stored as a deck asset in the SQLite DB):
- **Image** — PNG/JPEG/WebP/GIF, or SVG/PDF (rasterized on demand)
- **Demo** — a self-contained HTML file
- **Notebook** — a `.ipynb` (external Jupyter kernel or JupyterLite/Pyodide)
- **Video** — a local video file, or paste a YouTube/Vimeo/PeerTube URL for an embed

Other inserts:
- **HTML Element** (Insert → HTML Element) — the raw-HTML escape hatch (#137)
- Paste (Cmd+V) inserts an image/asset from the clipboard

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

Presentations can be edited programmatically through the CLI's JSON round-trip
(`eigendeck-cli deck.eigendeck export json …` → edit → `import json …`) or the CLI's
targeted edit commands — there is no loose `presentation.json` file to edit in place. See
[LLM-EDITING.md](LLM-EDITING.md) for the complete guide.

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
| Storage | SQLite (`rusqlite`), single `.eigendeck` file |
| Math rendering | MathJax 4 (per-font `-nosre` math packs, SVG) |
| Fonts | 10 bundled OFL families + 6 mono (default Lato) |

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

### Linked Objects (cross-slide animation) — now implemented
- See `docs/sync-and-link.md` for the settled sync/link model and lifecycle
- Position is governed by `syncId` (content link) and animation by `linkId` — both are
  live fields on every element (`BaseElement` in `src/types/presentation.ts`)
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

### Section Properties
- Per-section styling and configuration
- Sections group multiple slides with shared settings

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
- See `docs/sync-and-link.md` for the authoritative sync vs. link semantics (position is governed by `syncId`; `linkId` is animation only)

**Incremental write-through (not full reimport):**
- Zustand is the interaction layer (fast, synchronous for UI)
- Subscriber diffs previous and current state after each change
- Only dirty items are written to SQLite (elements, slides, metadata)
- Structural changes (add/delete slide/element) tracked explicitly
- `db_import_json` is NEVER used in normal editing flow — only to materialize a whole deck (New Project, import, first save / Save As); it resets structure but preserves assets
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

MathJax 4 with per-font math packs (one per bundled text font) renders `$...$` (inline) and `$$...$$` (display) LaTeX as SVG. PT Sans is used as the running example below.

### Build & Setup

All MathJax math packs — one per bundled text font — are built in the
sibling **dgleich/mathjax-fonts** repo, one `-nosre` bundle per font. They are
NOT committed here; `npm run setup` (`tools/setup-fonts.mjs`) copies the prebuilt
bundles into `public/mathjax/` (both `public/mathjax/` and the bundles are
gitignored). The old in-tree `mathjax-ptsans-bundle/` is gone.

**To deploy**: `npm run setup`.

**To rebuild a font** (changed metrics, MathJax bump): see the `update-fonts`
skill / `docs/updating-fonts.md` — pull mathjax-fonts, run its `build-all-nosre`
webpack, then `npm run setup`.

The `-nosre` variant excludes the Speech Rule Engine which creates blob: Workers that Tauri blocks.

### Font Parameters

Font metrics live in each pack's `cjs/common.js` in the mathjax-fonts repo, e.g.
for PT Sans:
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

- `\tilde{x}` accent — fixed in the PT Sans math font (April 2026)
- First MathJax render has a brief delay (script loading + first tex2svgPromise)
- fontCache: 'none' means SVG paths are duplicated (slightly larger HTML export)
- WebKit contentEditable: cursor appears left of list marker on empty new lines

---

## Development Workflow

### Local Development (Linux container on Mac)

```bash
# In the Colima/Docker container (/work is shared with Mac):
npm install
npm run build        # TypeScript + Vite build
npm test             # Vitest unit tests (47 tests)
cd src-tauri && cargo check && cargo test --lib -- --test-threads=1  # Rust (29 tests)
```

### macOS Testing

```bash
npm install          # Reinstalls macOS-native node_modules
bash tools/mac-build.sh    # Full dev mode with hot-reload
```

`node_modules/` is platform-specific — `npm install` when switching between Linux and Mac.

### CLI Tool

```bash
bash tools/build-cli.sh    # Builds src-tauri/target/release/eigendeck-cli

# Usage:
eigendeck-cli myproject.eigendeck info
eigendeck-cli myproject.eigendeck outline
eigendeck-cli myproject.eigendeck list slides
eigendeck-cli myproject.eigendeck list elements 3
eigendeck-cli myproject.eigendeck show slide 3
eigendeck-cli myproject.eigendeck show element abc     # partial ID match
eigendeck-cli myproject.eigendeck search "eigenvalue"
eigendeck-cli myproject.eigendeck history
eigendeck-cli myproject.eigendeck validate

# Editing:
eigendeck-cli myproject.eigendeck set-text abc "New text"
eigendeck-cli myproject.eigendeck add slide
eigendeck-cli myproject.eigendeck add text 3 "New body text"
eigendeck-cli myproject.eigendeck move element abc 400 300
eigendeck-cli myproject.eigendeck remove slide 5
eigendeck-cli myproject.eigendeck edit element abc '{"html":"..."}'

# Bulk edit (LLM workflow):
eigendeck-cli myproject.eigendeck export json /tmp/edit.json
# ... edit the JSON ...
eigendeck-cli myproject.eigendeck import json /tmp/edit.json

# Maintenance:
eigendeck-cli myproject.eigendeck compact --all     # delete all history
eigendeck-cli myproject.eigendeck unpack --demos    # extract assets to disk

# JSON output for machines/LLMs:
eigendeck-cli myproject.eigendeck --json list slides
eigendeck-cli myproject.eigendeck --json search "matrix"
```

### Converting Old JSON Projects

```bash
eigendeck-cli new.eigendeck import json old-project/presentation.json
# Then import assets:
eigendeck-cli new.eigendeck store-asset old-project/images/photo.png --as images/photo.png
eigendeck-cli new.eigendeck store-asset old-project/demos/demo.html --as demos/demo.html
```

Or use the batch script: `bash tools/convert-examples.sh`

### MathJax Setup

```bash
npm run setup   # copies the mathjax-fonts bundles into public/mathjax/
```

### Performance Benchmarks

```bash
node tools/bench-perf.mjs --save tools/perf-results/   # track over time
node tools/bench-storage.mjs example-demos/magnetic-powers   # SQLite vs ZIP vs JSON
node tools/test-history-integrity.mjs                   # verify temporal history
```

### Git

- Remote: `git@github.com:dgleich/eigendeck.git`
- Config: David Gleich <david@dgleich.com>
- Tags: `v0.1.0-revealjs` (last reveal.js version)
- CI: GitHub Actions (TypeScript, Vite, cargo check, clippy)
- Release: push tags `v*` for multi-platform builds
- Hooks: `git config core.hooksPath .githooks` (pre-commit warnings, post-commit perf)
