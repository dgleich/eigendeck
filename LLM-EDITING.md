# Editing Eigendeck Presentations with an LLM

This guide explains the `presentation.json` format so an LLM (like Claude Code)
can directly create and edit presentations.

## File Location

```
my-presentation/
  presentation.json     # Edit this file
  demos/                # HTML demo files (self-contained)
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
    "venue": "Conference 2026"
  }
}
```

## Slide Structure

Each slide has an `elements` array. Array order = z-order (first = bottom, last = top).

```json
{
  "id": "unique-uuid",
  "layout": "default",
  "elements": [ ... ],
  "notes": "Speaker notes for this slide"
}
```

`layout` can be: `"default"`, `"centered"`, `"two-column"`.

## Element Types

### Text Element

All text content uses `type: "text"` with a `preset` that determines default styling.

```json
{
  "id": "unique-uuid",
  "type": "text",
  "preset": "title",
  "html": "My Slide Title",
  "position": { "x": 80, "y": 40, "width": 1760, "height": 120 }
}
```

**Presets and their defaults:**

| Preset       | fontSize | fontFamily          | fontWeight | fontStyle | color   |
|-------------|----------|---------------------|------------|-----------|---------|
| `title`      | 72       | PT Sans             | bold       | normal    | #222    |
| `body`       | 48       | PT Sans             | normal     | normal    | #222    |
| `textbox`    | 48       | PT Sans             | normal     | normal    | #222    |
| `annotation` | 32       | PT Sans             | normal     | italic    | #2563eb |
| `footnote`   | 24       | PT Sans Narrow      | normal     | normal    | #888    |

**Optional overrides** (only include if different from preset default):
- `fontSize`: number (in slide units, 1920x1080 coordinate space)
- `fontFamily`: string (e.g., `"'PT Sans Narrow', sans-serif"`)
- `color`: string (CSS color, e.g., `"#dc2626"`)

**HTML content**: The `html` field supports basic HTML:
- `<b>bold</b>`, `<i>italic</i>`
- `<br>` for line breaks
- `<span style="color: #2563eb">colored text</span>`
- `<span style="font-size: 32px">sized text</span>`
- Plain text (no tags) is fine for simple content

**LaTeX math**: Use `$...$` for inline math and `$$...$$` for display math:
- `"html": "The eigenvalue $\\lambda$ satisfies $Ax = \\lambda x$"`
- `"html": "$$\\sum_{i=1}^n x_i^2$$"`
- Math is rendered as SVG using MathJax with a custom PT Sans math font
- Escape backslashes in JSON: `\\lambda` not `\lambda`

### Image Element

```json
{
  "id": "unique-uuid",
  "type": "image",
  "src": "images/diagram.png",
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 }
}
```

`src` is a relative path from the project directory. Images should be in `images/`.

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

## Coordinate System

- Slide canvas is **1920 x 1080** (16:9)
- Origin (0,0) is top-left
- All positions and sizes are in this coordinate space
- The app scales the canvas to fit the screen

**Typical layout guidelines:**
- Title at top: `y: 40`, full width: `x: 80, width: 1760`
- Body text below title: `y: 180`
- Footer area: `y: 980+`
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
      "position": { "x": 80, "y": 40, "width": 1760, "height": 120 }
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "type": "text",
      "preset": "body",
      "html": "Key algorithms:<br>• BFS traversal<br>• PageRank<br>• Connected components",
      "position": { "x": 80, "y": 200, "width": 1760, "height": 600 }
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "type": "text",
      "preset": "footnote",
      "html": "Based on Gleich et al., SISC 2015",
      "position": { "x": 80, "y": 980, "width": 1000, "height": 60 }
    }
  ],
  "notes": "Introduce the three main algorithms we'll cover"
}
```

## Tips for LLM Editing

1. **Read the file first** before making changes
2. **Preserve existing IDs** — don't regenerate IDs for elements you're not creating
3. **Add new slides** by appending to the `slides` array
4. **Reorder slides** by rearranging the array
5. **Reorder elements** (z-order) by rearranging within `elements` array
6. **Keep the config** section unchanged unless specifically asked to modify it
7. **Use presets** — don't override fontSize/color unless the user asks for it
8. **Test by opening** the file in Eigendeck after editing
