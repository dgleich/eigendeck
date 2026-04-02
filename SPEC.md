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
