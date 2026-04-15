# Editing Eigendeck Presentations with an LLM

This guide explains how to edit Eigendeck presentations programmatically.

## Two Formats

### SQLite (`.eigendeck` file) — preferred

Use the `eigendeck-cli` tool. Every edit is automatically versioned (undo-safe).

```bash
# Read
eigendeck-cli deck.eigendeck outline              # text outline of all slides
eigendeck-cli deck.eigendeck list slides           # list slides with element counts
eigendeck-cli deck.eigendeck list elements 3       # elements on slide 3
eigendeck-cli deck.eigendeck show element abc      # full JSON (partial ID match)
eigendeck-cli deck.eigendeck search "eigenvalue"   # find text across all slides
eigendeck-cli deck.eigendeck get-text abc          # plain text of element
eigendeck-cli deck.eigendeck info                  # presentation stats
eigendeck-cli deck.eigendeck history               # edit history

# Write (each creates a versioned snapshot)
eigendeck-cli deck.eigendeck set-text abc "New text with $\LaTeX$"
eigendeck-cli deck.eigendeck add text 3 "A new bullet point"
eigendeck-cli deck.eigendeck add slide --after 5
eigendeck-cli deck.eigendeck move element abc 400 300
eigendeck-cli deck.eigendeck move slide 3 1
eigendeck-cli deck.eigendeck remove element abc
eigendeck-cli deck.eigendeck remove slide 5
eigendeck-cli deck.eigendeck edit element abc '{"html":"...","position":{...}}'

# Bulk edit: export → edit JSON → reimport
eigendeck-cli deck.eigendeck export json /tmp/edit.json
# ... edit /tmp/edit.json ...
eigendeck-cli deck.eigendeck import json /tmp/edit.json

# Maintenance
eigendeck-cli deck.eigendeck validate              # check for issues
eigendeck-cli deck.eigendeck compact               # shrink DB, prune old history
eigendeck-cli deck.eigendeck unpack --demos         # extract demos for editing
```

### JSON directory (legacy)

```
my-presentation/
  presentation.json     # Edit this file directly
  demos/                # HTML demo files
  images/               # Image files
```

## Presentation Structure

```json
{
  "title": "My Talk",
  "theme": "white",
  "slides": [ ... ],
  "config": {
    "transition": "slide",
    "backgroundTransition": "fade",
    "width": 1920,
    "height": 1080,
    "showSlideNumber": true,
    "author": "Author Name",
    "venue": "Conference 2026",
    "mathPreamble": "\\newcommand{\\R}{\\mathbb{R}}"
  }
}
```

- `mathPreamble`: optional LaTeX preamble applied to all MathJax rendering (e.g. `\newcommand`, `\def`)

## Slide Structure

Each slide has an `elements` array. Array order = z-order (first = bottom, last = top).

```json
{
  "id": "unique-uuid",
  "layout": "default",
  "elements": [ ... ],
  "notes": "Speaker notes for this slide",
  "groupId": "optional-group-uuid"
}
```

- `layout`: `"default"`, `"centered"`, or `"two-column"`
- `groupId`: optional — slides with the same groupId form a group (shared numbering, used for build animations)

## Element Types

All elements share these base fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique UUID |
| `position` | `{x, y, width, height}` | Position in slide coordinates |
| `linkId` | string? | Animation link: elements with same linkId animate between slides |
| `syncId` | string? | Content sync: elements with same syncId stay in sync across slides |
| `_linkId` | string? | Stored linkId when temporarily unlinked |
| `_syncId` | string? | Stored syncId when temporarily unsynced |

### Text Element

```json
{
  "id": "unique-uuid",
  "type": "text",
  "preset": "title",
  "html": "My Slide Title",
  "position": { "x": 80, "y": 20, "width": 1760, "height": 200 },
  "verticalAlign": "bottom"
}
```

**Presets and their defaults:**

| Preset       | fontSize | fontFamily          | fontWeight | fontStyle | color   | Default position |
|-------------|----------|---------------------|------------|-----------|---------|-----------------|
| `title`      | 72       | PT Sans             | bold       | normal    | #222    | `y:20, h:200` (bottom-aligned) |
| `body`       | 48       | PT Sans             | normal     | normal    | #222    | `y:180, h:800` |
| `textbox`    | 48       | PT Sans             | normal     | normal    | #222    | `y:300, h:300` |
| `annotation` | 32       | PT Sans             | normal     | italic    | #2563eb | `y:700, h:150` |
| `footnote`   | 24       | PT Sans Narrow      | normal     | normal    | #888    | `y:1020, h:44` (bottom-aligned) |

**Optional overrides** (only include if different from preset default):
- `fontSize`: number (in slide units, 1920x1080 coordinate space)
- `fontFamily`: string (e.g., `"'PT Sans Narrow', sans-serif"`)
- `color`: string (CSS color, e.g., `"#dc2626"`)
- `verticalAlign`: `"top"` | `"middle"` | `"bottom"` — vertical text alignment within the box. Title and footnote default to `"bottom"`.

**HTML content**: The `html` field supports basic HTML:
- `<b>bold</b>`, `<i>italic</i>`, `<s>strikethrough</s>`
- `<br>` for line breaks
- `<ul><li>list items</li></ul>` — rendered with `- ` markers
- `<span style="color: #2563eb">colored text</span>`
- `<span style="font-size: 32px">sized text</span>`
- `<span style="text-transform: uppercase; letter-spacing: 0.08em">CAPS</span>`
- Plain text (no tags) is fine for simple content

**LaTeX math**: Use `$...$` for inline math and `$$...$$` for display math:
- `"html": "The eigenvalue $\\lambda$ satisfies $Ax = \\lambda x$"`
- `"html": "$$\\sum_{i=1}^n x_i^2$$"`
- Math is rendered as SVG using MathJax with a custom PT Sans math font
- Escape backslashes in JSON: `\\lambda` not `\lambda`
- Custom commands from `config.mathPreamble` are available

### Image Element

```json
{
  "id": "unique-uuid",
  "type": "image",
  "src": "images/diagram.png",
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 },
  "shadow": true,
  "borderRadius": 12,
  "opacity": 0.9,
  "rotation": -3
}
```

- `src`: relative path from the project directory. Images should be in `images/`.
- `shadow`: optional boolean — adds a drop shadow
- `borderRadius`: optional number — rounded corners in pixels
- `opacity`: optional number 0–1 — image transparency
- `rotation`: optional number — rotation in degrees

### Cover Element

```json
{
  "id": "unique-uuid",
  "type": "cover",
  "position": { "x": 80, "y": 200, "width": 800, "height": 600 },
  "color": "#ffffff"
}
```

A plain rectangle used to cover/hide other elements. Shows as a dashed outline in the editor, solid in presenter/export.

- `color`: optional CSS color (default white)

### Arrow Element

```json
{
  "id": "unique-uuid",
  "type": "arrow",
  "x1": 400, "y1": 500,
  "x2": 800, "y2": 300,
  "position": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "color": "#e53e3e",
  "strokeWidth": 4,
  "headSize": 16
}
```

Arrow coordinates (`x1,y1` to `x2,y2`) are in slide space (1920x1080).
The `position` field is required but ignored for arrows (use x1/y1/x2/y2).

### Demo Element

```json
{
  "id": "unique-uuid",
  "type": "demo",
  "src": "demos/bfs-demo.html",
  "position": { "x": 80, "y": 200, "width": 1760, "height": 700 }
}
```

Demo files must be self-contained HTML (inline CSS/JS, or CDN references).

### Demo-Piece Element

```json
{
  "id": "unique-uuid",
  "type": "demo-piece",
  "demoSrc": "demos/simulation.html",
  "piece": "graph-view",
  "position": { "x": 80, "y": 200, "width": 900, "height": 600 },
  "demoState": {}
}
```

Demo-piece elements are viewport fragments of a multi-piece demo. The demo HTML file receives a hash fragment indicating its role:

- **Viewport iframes**: loaded with `demoSrc#piece=PIECENAME` — render one visual piece of the demo
- **Controller iframe**: loaded with `demoSrc#role=controller` — runs the simulation/logic, hidden (zero-size)

The controller iframe is automatically added (one per unique `demoSrc` on the current slide). Communication between controller and viewports uses `BroadcastChannel` with a channel name derived from the demo's src path.

> **Export note:** In HTML exports, demos run in `srcdoc` iframes. Eigendeck injects a bootstrap that patches `URLSearchParams` and `BroadcastChannel` so the standard `location.hash` / `location.pathname` patterns work. Demo authors don't need special handling. See `DEMO_AUTHORING.md` for the full demo authoring guide.

| Field | Type | Description |
|-------|------|-------------|
| `demoSrc` | string | Relative path to the demo HTML file |
| `piece` | string | Name of the piece/viewport to render |
| `demoState` | object? | Optional state to pass to the demo |

Multiple `demo-piece` elements can reference the same `demoSrc` with different `piece` names to show different views of the same simulation side by side.

## Linked Objects

Elements can be linked across slides for animation and content synchronization.

### Animation Links (`linkId`)
Elements with the same `linkId` on consecutive slides animate between positions in the presenter:
- Same position → no visible animation
- Different position → smooth 300ms ease-in-out transition
- Element only on previous slide → fade out
- Element only on current slide → fade in

### Content Sync (`syncId`)
Elements with the same `syncId` stay synchronized across all slides:
- Moving a synced element updates its position on every slide
- Editing text on a synced element updates text on every slide
- Use this for titles, footers, or any content that should be identical everywhere

### Workflow
When duplicating a slide, both `linkId` and `syncId` are set automatically. To make an element animate to a new position:
1. Remove `syncId` (or set to undefined) — this "frees" the position
2. Keep `linkId` — this preserves the animation link
3. Move the element to its new position on the duplicate slide

## Slide Groups

Slides with the same `groupId` form a group:
- Groups share a single slide number (e.g., slides [A, B1, B2, C] show [1, 2, 2, 3])
- First slide in group = parent, subsequent = children (indented in sidebar)
- Use `+ Build` to duplicate a slide into the same group

## Coordinate System

- Slide canvas is **1920 x 1080** (16:9)
- Origin (0,0) is top-left
- All positions and sizes are in this coordinate space
- The app scales the canvas to fit the screen

**Typical layout guidelines:**
- Title at top: `y: 20`, full width: `x: 80, width: 1760, height: 200`
- Body text below title: `y: 220`
- Footer area: `y: 1020+`
- Centered content: `x: 160-360` with `width: 1200-1600`
- Side margins: at least 80px

## Generating UUIDs

Every `id` must be unique. Use UUID v4 format:
`"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"`

## Example: Complete Slide

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "layout": "default",
  "elements": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "type": "text",
      "preset": "title",
      "html": "Graph Algorithms for HPC",
      "position": { "x": 80, "y": 20, "width": 1760, "height": 200 },
      "verticalAlign": "bottom"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "type": "text",
      "preset": "body",
      "html": "Key algorithms:<br><ul><li>BFS traversal</li><li>PageRank</li><li>Connected components</li></ul>",
      "position": { "x": 80, "y": 220, "width": 1760, "height": 600 }
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "type": "text",
      "preset": "footnote",
      "html": "Based on Gleich et al., SISC 2015",
      "position": { "x": 80, "y": 1020, "width": 1000, "height": 44 },
      "verticalAlign": "bottom"
    }
  ],
  "notes": "Introduce the three main algorithms we'll cover"
}
```

## Tips for LLM Editing

1. **Read the file first** before making changes
2. **Preserve existing IDs** — don't regenerate IDs for elements you're not creating
3. **Preserve linkId/syncId** — don't remove these unless asked; they control animations and sync
4. **Add new slides** by appending to the `slides` array
5. **Reorder slides** by rearranging the array
6. **Reorder elements** (z-order) by rearranging within `elements` array
7. **Keep the config** section unchanged unless specifically asked to modify it
8. **Use presets** — don't override fontSize/color unless the user asks for it
9. **Test by opening** the file in Eigendeck after editing
