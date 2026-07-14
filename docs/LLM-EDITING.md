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
    "mathPreamble": "\\newcommand{\\R}{\\mathbb{R}}",
    "defaultTitleFont": "ptsans",
    "defaultBodyFont": "ptsans",
    "defaultHypeFont": "shantell",
    "autoReloadAssets": "off"
  }
}
```

- `mathPreamble`: optional LaTeX preamble applied to all MathJax rendering (e.g. `\newcommand`, `\def`)
- `defaultTitleFont` / `defaultBodyFont` / `defaultHypeFont`: optional default font package ids (see `src/lib/fonts.ts`). Available ids include `"ptsans"`, `"libertinus"`, `"libertinus-sans"`, `"lm-sans"`, `"noto-sans"`, `"source-sans"`, `"source-code"`, `"shantell"`, `"concrete-euler"`. Slides may override via `Slide.titleFont` / `bodyFont` / `hypeFont`. Missing values resolve to `"ptsans"`.
- `defaultMonoFont`: optional default monospace font package id, used by notebook code cells. Falls back to `"source-code"` (Source Code Pro, bundled). Notebook prose cells use the body font; only code cells / outputs use this.
- `footerFont`: optional font package id for the slide footer (the author·venue line + slide number). Unset → `"ptsans"` (PT Sans, the historical default). Deck-level only.
- `textSizes`: optional partial map overriding the deck's named type scale. Keys: `"footnote"` (default 24), `"note"` (32), `"body"` (48), `"title"` (72), `"hype"` (96). Values in slide-pixels. Absent keys fall back to the defaults. Used by every element that picks a size by name (notebook `fontSizeName`, and — as text presets are retrofitted — text element sizes).
- `autoReloadAssets`: optional per-presentation override for the file-watching auto-reload behavior. `"on"` or `"off"` overrides the global preference; absent means follow the global. Per-asset overrides in `assets.auto_reload` still win.
- `customPalette`: optional array of `#rrggbb` hex strings — a per-presentation color palette (e.g. brand colors) shown as a leading swatch row on **every** color control (the shared `<ColorControl>`: the inline text toolbar plus the inspector text-color / background / arrow / cover pickers). Edited in the Deck inspector ("Color Palette"). Purely an editing affordance; a chosen color is written to the same field as any other swatch (inline HTML for the toolbar, `color`/`backgroundColor` for the inspector).
- `deckToken`: **app-managed — do NOT author or copy this.** A random deck-identity token the app stamps when it *creates* a deck (File → New / scratch); it keys the per-machine asset-security trust ledger (`docs/ASSETS-SECURITY.md`). Setting or copying it in JSON does not grant trust (trust lives in the app-side ledger, not the deck), and inventing one only muddies identity. Leave it absent; the app fills it in.

## Slide Structure

Each slide has an `elements` array. Array order = z-order (first = bottom, last = top).

```json
{
  "id": "unique-uuid",
  "theme": "dark",
  "elements": [ ... ],
  "notes": "Speaker notes for this slide",
  "groupId": "optional-group-uuid",
  "titleFont": "shantell",
  "bodyFont": "ptsans",
  "hypeFont": "concrete-euler"
}
```

- `theme`: optional per-slide theme override (otherwise inherits `presentation.theme`)
- `groupId`: optional — slides with the same groupId form a group (shared numbering, used for build animations)
- `titleFont` / `bodyFont` / `hypeFont`: optional per-slide font package overrides. Values are font ids from `src/lib/fonts.ts` (e.g. `"ptsans"`, `"shantell"`, `"libertinus"`). Title preset uses `titleFont`, hype preset uses `hypeFont`, all others use `bodyFont`. Falls back to `presentation.config.default*Font`, then `"ptsans"`. Math always follows the same font as the surrounding preset.
- `omitFooter`: optional boolean. When `true`, this slide draws no footer (author·venue meta + slide number both hidden) — e.g. title slides, section dividers, full-bleed html slides. Numbering keeps counting through an omitted slide, so other slides' numbers stay stable. Absent/`false` = footer shown.

> **Storage note**: at the SQLite level, the `theme`/`titleFont`/`bodyFont`/`hypeFont`/`omitFooter` fields are bundled into a single optional `slides.config` JSON column. Absent fields = inherit. Most slides have `config = NULL` (no overrides). The runtime cascade (element override → slide override → presentation default) does the resolution.

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
| `title`      | 72       | PT Sans             | bold       | normal    | #222    | `x:60, y: 60, 1800×180` (bottom-aligned) |
| `body`       | 48       | PT Sans             | normal     | normal    | #222    | `x:60, y:240, 1800×750` (flush under the title) |
| `textbox`    | 48       | PT Sans             | normal     | normal    | #222    | `x:210, y:330, 810×330` |
| `annotation` | 32       | PT Sans             | normal     | italic    | #2563eb | `x:210, y:720, 600×150` |
| `footnote`   | 24       | PT Sans Narrow      | normal     | normal    | #888    | `x:60, y:990, 1020×30` (bottom-aligned; renders tight — no padding, 1.0 line-height) |
| `hype`       | 48 (body) | Shantell (or hypeFont) | normal  | normal    | #1a1a1a | `x:720,y:360, 570×360` — **sticky note**: seeded with `backgroundColor:"#fde047"` (bright yellow) + Shantell Sans + `rotation:-4` (jaunty tilt) |

Defaults sit on the **30px** alignment grid with a 60px (2-cell) outer margin.

**Optional overrides** (only include if different from preset default):
- `fontSizeName`: one of `"footnote"`, `"note"`, `"body"` — picks a named size from the deck's type scale, overriding the preset's default size. `"title"` and `"hype"` are intentionally excluded; the numeric `fontSize` covers those cases.
- `fontSize`: number (in slide units, 1920×1080 coordinate space). Beats `fontSizeName` when both set.
- `fontFamily`: string (e.g., `"'PT Sans Narrow', sans-serif"`)
- `color`: string (CSS color, e.g., `"#dc2626"`) — or the special **`"accent"`** token (#132), a **live theme-relative** foreground: it resolves to the slide theme's accent at render and re-adapts if the theme changes (unlike a baked hex). Also valid on `arrow` `color`. Absent = the preset's theme default.
- `verticalAlign`: `"top"` | `"middle"` | `"bottom"` — vertical text alignment within the box. Title and footnote default to `"bottom"`.
- `backgroundColor`: string (CSS color) — fill behind the text box (e.g., a caption panel over a busy background). Absent = transparent.
- `backgroundOpacity`: number 0–1 (default 1) — opacity applied to `backgroundColor` (combined into rgba at render, so the text itself isn't faded).
- `boxTint`: string — a **theme-relative** fill (the "Card" look, #132). `"accent"` mixes the slide theme's accent into the theme background; a hex value tints that color instead. Resolved per-theme at render, so the fill stays colored **and** contrasting on any theme: light themes get a pale pastel (~20% mix), dark/black themes mix the SATURATED base in far more strongly (~52%) so the panel reads as a real colored surface instead of a muddy grey. Takes precedence over `backgroundColor`. Pairs with `boxShadow` + `borderRadius` for a Beamer-block card. The **+ Card** insert seeds a text element with `boxTint:"accent"`, `borderRadius:30`, `boxShadow:true`, and a bold all-caps first line + body line.
- `textEffect`: `"shadow"` | `"glow"` — decoration on the **text**. `"shadow"` = soft `text-shadow`; `"glow"` = high-contrast halo (white or black, auto-chosen opposite the text color's luminance). Absent = none.
- `boxShadow`: boolean — a drop shadow on the **box** (the background panel), like a card/sticky-note. Independent of `textEffect`; only has effect when `backgroundColor` is set (the inspector only offers it then). Absent/false = none.
- `borderRadius`: number (px, slide coords) — rounds the corners of the **background panel**, so a tinted fill reads as a rounded card. Only meaningful when `backgroundColor` is set (the inspector only offers it then). Absent/0 = square. Mirrors the image element's `borderRadius`; applied across editor/present/export. **Card pattern**: an empty rounded-fill text box (`backgroundColor` + `borderRadius`, no text) makes a panel you can layer separate heading/body/equation text boxes on top of — keeps one font-size per element while still getting a "card".
- `padding`: `{ top, right, bottom, left }` (px, slide coords) — per-side inner padding overriding the preset default (8/12, or 0 for footnote). Pairs with `backgroundColor` + `borderRadius` to give a tinted box breathing room (e.g. a code chip). Absent = preset default. Inspector edits all four with an optional "link" toggle. Applied across editor/present/export.
- **HTML is sanitized to the toolbar allowlist** on load/import, paste, and edit-commit (`sanitizeRichText`): only tags/styles the format toolbar can produce survive — `b/strong/i/em/u/s/strike/span/div/p/br/ul/ol/li/font/code` and the style props `color, font-weight, font-style, text-decoration, text-transform, letter-spacing, text-align`. (`<code>` is the toolbar's `</>` monospace run; it renders in the deck's `config.defaultMonoFont`.) **Inline `font-size`, `background`, `margin`, `padding`, `border*`, `font-family` and all other styles/tags/attrs (incl. event handlers, `javascript:` URLs, `<script>/<img>/<iframe>`) are stripped.** So a JSON-authored `html` that relies on those will be reduced when the deck is opened — express size via the element's `fontSize`, fills via `backgroundColor`/`borderRadius`/`padding`, and structure via separate elements.
- `rotation`: number (degrees, clockwise) — tilts the WHOLE text box, background panel included (angled sticky-note callout). Absent/0 = upright. Hype elements default to `-4`. Applied as a `rotate()` transform across editor/present/export.

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
- **Escape `<` and `>` inside math** — write `\\lt` / `\\gt` (or `&lt;` / `&gt;`), never a raw `<`. The `html` field is parsed as HTML by the sanitizer, so a raw `<` in `$k<r$` is read as a tag start and the expression is mangled. (The in-app editor escapes `<`→`&lt;` automatically; only hand-written JSON hits this.)
- Custom commands from `config.mathPreamble` are available

### Image Element

```json
{
  "id": "unique-uuid",
  "type": "image",
  "assetId": "f3b8...e91",
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 },
  "shadow": true,
  "borderRadius": 12,
  "opacity": 0.9,
  "rotation": -3
}
```

- `assetId`: REQUIRED UUID — stable binding to a specific row in the `assets` table. The asset owns the bytes, the path label (e.g. `images/diagram.png`), the external source-file link, and the watch settings. Elements never carry a path — display label comes from `asset.path` via lookup.
- `shadow`: optional boolean — adds a drop shadow
- `borderRadius`: optional number — rounded corners in pixels
- `opacity`: optional number 0–1 — image transparency
- `rotation`: optional number — rotation in degrees
- `kind`: optional `'raster' | 'svg' | 'pdf'` — source format. Absent means
  `'raster'` (PNG/JPEG/WebP/GIF). Set `'svg'` for SVG sources and `'pdf'`
  for PDF sources; the editor handles display.
- `snapshotVariant`: optional string — for sources with multiple cached
  variants (future: PDF page number like `'p2'`, demo configuration name
  like `'converged'`). Defaults to `'_'` (single-page / single-variant);
  ignored for SVG and single-page PDFs.

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

- `color`: optional CSS color. Absent = **matches the slide background** (an invisible reveal mask).
- `boxTint`: string — a **theme-relative** fill (#132), same tokens as text `boxTint` (`"accent"` or a hex base, resolved as a wash against the slide theme). Takes precedence over `color`, so a colored mask stays on-theme across white/dark/colored themes.

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
  "headSize": 16,
  "heads": "end",
  "opacity": 1,
  "c1x": 500, "c1y": 620,
  "c2x": 700, "c2y": 620
}
```

Arrow coordinates (`x1,y1` to `x2,y2`) are in slide space (1920x1080).
The `position` field is required but ignored for arrows (use x1/y1/x2/y2).
- `heads`: `"end"` (default) | `"start"` | `"both"` | `"none"` — which ends get an arrowhead. The line is automatically pulled back to the head base so the stroke doesn't poke through the tip.
- `opacity`: number 0–1 (default 1) — arrow stroke/fill opacity.
- `c1x`/`c1y`/`c2x`/`c2y`: optional cubic-Bézier control points (#129) — `c1` is the handle off the start, `c2` off the end. When **all four** are present the arrow curves (`M x1 y1 C c1x c1y c2x c2y x2 y2`); omit any and it's a straight line. Arrowheads orient to the curve tangent at each tip. In the editor these are the Inkscape-style handles shown when an arrow is selected (drag to bend, double-click to straighten); the inspector's Shape toggle sets or clears them.
- `points`: optional array of interior interpolation points `[{x,y}, …]` (#129) — the curve passes **smoothly through** each, between the handled endpoints. The end tangents still come from `c1`/`c2`; interior knots get automatic (Catmull-Rom) tangents, so there are **no handles** on interior points — just draggable dots. Only used when the arrow is curved (`c1`/`c2` present). In the editor, the inspector's **"+ Point"** button (Shape section) adds one; drag the on-canvas dot to route, double-click it to remove. "Straight" clears `points` too.

### Demo Element

```json
{
  "id": "unique-uuid",
  "type": "demo",
  "assetId": "a3c8...11d",
  "position": { "x": 80, "y": 200, "width": 1760, "height": 700 }
}
```

Demo files must be HTML that begins with the `<!--eigendeck-demo-v1-->` marker (right after `<!DOCTYPE html>`) or they won't mount. They should be self-contained (inline CSS/JS); a demo is **offline by default**, so any CDN reference or `fetch` host must be declared in an `application/eigendeck-manifest+json` block in `<head>` or it's blocked and the demo renders blank (see `DEMO_AUTHORING.md` → "Internet access"). The asset's `path` (typically `demos/bfs-demo.html`) is its display label; the bytes live in the `assets` table.

- `assetId`: REQUIRED UUID — stable binding to the demo HTML asset.

### Demo-Piece Element

```json
{
  "id": "unique-uuid",
  "type": "demo-piece",
  "assetId": "a3c8...11d",
  "piece": "graph-view",
  "position": { "x": 80, "y": 200, "width": 900, "height": 600 },
  "demoState": {}
}
```

- `assetId`: REQUIRED UUID — stable binding to the demo HTML asset.
- `piece`: string — name of the piece/viewport to render.
- `demoState`: optional object — state passed to the demo.

Demo-piece elements are viewport fragments of a multi-piece demo. The demo HTML file (loaded via the asset's bytes) receives a hash fragment indicating its role:

- **Viewport iframes**: loaded with `#piece=PIECENAME` — render one visual piece of the demo
- **Controller iframe**: loaded with `#role=controller` — runs the simulation/logic, hidden (zero-size)

The controller iframe is automatically added (one per unique `assetId` on the current slide). Communication between controller and viewports uses `BroadcastChannel`.

> **Export note:** In HTML exports, demos run in `srcdoc` iframes. Eigendeck injects a bootstrap that patches `URLSearchParams` and `BroadcastChannel` so the standard `location.hash` / `location.pathname` patterns work. Demo authors don't need special handling. See `DEMO_AUTHORING.md` for the full demo authoring guide.

Multiple `demo-piece` elements can reference the same `assetId` with different `piece` names to show different views of the same simulation side by side.

### Notebook Element

```json
{
  "id": "unique-uuid",
  "type": "notebook",
  "assetId": "9f1c...8a4",
  "kernel": { "kind": "external", "kernelName": "julia-1.10" },
  "preamble": "using LinearAlgebra",
  "autoRun": false,
  "position": { "x": 80, "y": 200, "width": 1760, "height": 800 }
}
```

- `assetId`: REQUIRED UUID — stable binding to the `.ipynb` asset.
- `kernel`: optional kernel backend (`{ kind: 'external', kernelName? }` or `{ kind: 'lite' }`). When absent, cascades to `PresentationConfig.notebookKernel`, then `'python3'` as the final default. See `DESIGN_DECISIONS.md` "Preferences cascade." **Server URL and authentication token are NOT on the element** — they live in the per-machine app preference `jupyterServers` registry (Settings → Jupyter servers). At render time, the first registered server whose `availableKernels` includes the resolved `kernelName` is the one we dial.
- `preamble`: optional string — setup code run before the visible cells. Useful for imports + helpers so the slide's cells stay short.
- `autoRun`: optional boolean (default false) — when true, all visible cells execute on slide enter in PresentMode.
- `visibleCells`: optional array of zero-indexed cell numbers — restricts which cells appear in the rendered notebook. Absent = show all cells.
- `syntaxHighlight`: optional boolean (default true) — color code cells using highlight.js with the grammar picked from the notebook's `kernelspec.language`. Set to `false` to render code unhighlighted. Common kernels supported out of the box (python, julia, r, javascript, typescript, c, cpp, rust, go, bash, sql, java, kotlin, swift, ruby, php). The palette is theme-aware (GitHub-light on light slide themes, GitHub-dark on dark ones).
- `showLineNumbers`: optional boolean (default false) — show a line-number gutter in editable code cells (the CodeMirror editor). Off by default (cleaner on a slide); enable when you want to refer to "line N" while presenting.
- `hideMarkdown`: optional boolean (default false) — hide markdown cells, showing only code + outputs ("focus on the code").
- `hideHeader`: optional boolean (default false) — hide the kernel-name header row. The small busy-status dot (top-left) stays regardless.
- `showBorder`: optional boolean (default false) — draw a thin frame border. Default is borderless: the notebook blends into the slide using the theme's background + text colors.
- `editable`: optional boolean. When unset, falls back to the global `defaultNotebookEditable` preference (default false → read-only). Turning it on makes code cells editable AND disables file-watching for the bound asset (so in-deck edits aren't clobbered by a disk reload). The asset keeps its `external_path`, so the Asset section's "Reload from disk" still works — and a manual reload discards the `cellEdits` overlay.
- `cellEdits`: optional `{ [cellIndex: number]: string }` overlay of in-deck source edits, keyed by the cell's zero-based index. When present for a cell, the source replaces the asset's cell source for display + execution; the underlying `.ipynb` (and any linked file on disk) is left untouched. Lets a presenter tweak a value (`k = 5` → `k = 10`) for a talk without rewriting the notebook. Requires `editable`. Edits are made in the editor (double-click the notebook to interact, then type in a cell); the "⟲" button reverts a single cell; "Reload from disk" clears all. Safe from index drift because editing disables auto-reload.
- `fontSizeName`: optional named size from the deck's type scale. One of `"footnote"`, `"note"`, `"body"`. (`"title"` and `"hype"` are intentionally not allowed for notebooks — title is reserved for title text elements.) Resolves through `PresentationConfig.textSizes[name]` then `DEFAULT_TEXT_SIZES[name]`. Default is `"note"` (32 px) when absent.
- `fontSize`: optional explicit numeric override (slide-pixels). When set, beats `fontSizeName`. Use this when no named bucket fits. Inspector exposes the spinner alongside the named buttons.

Notebook prose cells inherit the slide's body font (`Slide.bodyFont` → `PresentationConfig.defaultBodyFont` → `'ptsans'`). Notebook code cells use `PresentationConfig.defaultMonoFont` → `'source-code'` (Source Code Pro, bundled).

Notebook elements render as a live, interactive Jupyter UI inside an iframe. Two kernel backends are supported (default to external):

- **`external`**: connects via REST + WebSocket to a user-run `jupyter server`. Supports any installed kernel (Python, Julia, R, ...). The server URL + token come from `PrefSchema.jupyterServers`, picked by matching `availableKernels`. If no registered server advertises the requested kernel, the notebook renders but can't run (status pill shows red).
- **`lite`**: runs a self-contained Pyodide kernel inside the WebView via a bundled JupyterLite distribution. Python-only, but the deck works on any machine without Jupyter installed — use this for portable demo decks.

### Video Element

A movie: either a **local file** stored as an asset (`kind: "file"`) or a hosted
**embed** by URL (`kind: "embed"` — YouTube / Vimeo / PeerTube).

```json
{
  "id": "unique-uuid",
  "type": "video",
  "kind": "file",
  "assetId": "b7e2...44c",
  "loop": true,
  "playbackRate": 1,
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 }
}
```

```json
{
  "id": "unique-uuid",
  "type": "video",
  "kind": "embed",
  "provider": "youtube",
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "loop": true,
  "position": { "x": 360, "y": 200, "width": 1200, "height": 680 }
}
```

- `kind`: REQUIRED — `"file"` or `"embed"`.
- `assetId`: file kind — REQUIRED UUID, the stored video asset (mp4/webm/mov/…). Bytes are embedded in the deck like images; the asset keeps its `external_path`, so the video is **file-watched** (re-encode/replace the source on disk → it reloads). No "take control" concept (video isn't edited in-deck).
- `provider` / `url`: embed kind — `provider` is `"youtube" | "vimeo" | "peertube"`; `url` is the original pasted URL (the provider + video id are re-parsed from it at render time). PeerTube keeps the instance origin from the URL.
- `captionsAssetId` / `captionsLabel`: file kind — an optional **WebVTT (`.vtt`) sidecar** asset rendered as a `<track>` (browser `<video>` can't read subtitles embedded inside the container, so captions need this sidecar). `captionsLabel` is the track label.

Playback options (all toggles default **off**; `playbackRate` defaults to **1**):

- `loop`: boolean — loop forever.
- `pingPong`: boolean — **file only**, ping-pong reverse loop (forward, then reverse-seek back, repeat). Best-effort: smooth only for short clips (reverse has no native support — it's done by reverse-seeking). Disables native `loop` when on.
- `playbackRate`: number — speed (0.25–2×). For **embeds** this is applied best-effort via each provider's postMessage player API (YouTube IFrame API / Vimeo player.js / PeerTube PlayerAPI), since no URL param sets it.
- `autoplay`: boolean — play on slide enter (PresentMode). Browsers require muted autoplay, so it forces mute.
- `controls`: boolean — show the native controls bar. When off in present mode the video is chrome-free (click-to-play in the editor).
- `muted`: boolean — start muted.
- `captions`: boolean — show captions: the `.vtt` `<track>` for files, the provider's CC param for embeds (best-effort).

A poster frame (file) or the provider thumbnail (embed) is captured into the preview cache for the sidebar mini-slides and static export (`previewCache`, variant `preview`). Add via the "+ Video" toolbar button (file picker or pasted URL) or by **dragging a video file** onto the canvas.

### HTML Element

The **raw-HTML escape hatch** (#137) — a general element for arbitrary design/layout
markup when no other element fits. This is the element to reach for when you want to
"go wild" with custom HTML/CSS (gradients, grids, SVG, tables, fancy typography). It
is **not** the text element (no rich-text presets) and **not** a demo (no scripting).

```json
{
  "id": "unique-uuid",
  "type": "html",
  "html": "<div style=\"display:grid;place-items:center;height:100%;font-family:system-ui\"><h1 style=\"font-size:64px;background:linear-gradient(90deg,#6366f1,#ec4899);-webkit-background-clip:text;color:transparent\">Hello</h1></div>",
  "background": "#0b1020",
  "position": { "x": 560, "y": 340, "width": 800, "height": 400 }
}
```

- `html`: REQUIRED — the raw HTML rendered inside the element's box (it becomes the
  `<body>` of a sandboxed `srcdoc` iframe).
- `background`: optional CSS color for the box. Omit for **transparent** (composites
  onto the slide).
- `interactive`: optional boolean (default false). When true the element **receives
  mouse events**, so native script-less interactivity works — `<input type="range">`,
  radio/checkbox `:checked` state, `<details>`, `:hover`. It becomes clickable in
  present mode (and double-click on the canvas enters an "interact" mode instead of
  editing). Leave false/omitted for plain static design HTML so it never blocks the
  slide. (Still no JavaScript — interactivity is CSS/native-control only, e.g. a
  radio-driven `:checked ~ .fill { height: … }` thermometer.)
- `scaleMode`: optional boolean (default false). When true the content is scaled to
  **fit the box** (uniform "contain" — aspect ratio preserved, letterboxed), so
  resizing the box grows/shrinks fixed-size markup instead of clipping it. The content
  is laid out at its **natural design size** (`scaleW`×`scaleH`) and CSS-transformed to
  fit. In the app, ticking the checkbox MEASURES the content's natural size and stores
  it (so toggling it is idempotent); in JSON, set `scaleW`/`scaleH` to the size the
  `html` is authored for.
- `scaleW`, `scaleH`: the content's natural design width/height (slide px); only
  used when `scaleMode` is true. Missing/zero → no scaling (renders 1:1).
- `vars`: optional `{ [name]: string | number }` — **variable VALUES** (#138). The
  *declaration* (type/default/range/help) lives in a manifest inside `html` (below);
  `vars` only overrides defaults. A value equal to the default may be omitted.
- `position`: standard box (slide space, 1920×1080).

**Variables (#138).** An html element can declare typed variables that splice into
its markup two ways — as CSS custom properties (`var(--name)`, for the visual) and as
`{{name}}` tokens (for real text) — so one knob (edited in the Inspector's **Variables**
section) drives both. Declare them in a JSON data-island in `html` (it never executes
— the sandbox has no scripts — and is stripped from the render):

```html
<script type="application/eigendeck-vars+json">
{
  "value": { "type": "float",  "default": 62, "min": 0, "max": 100, "step": 0.5, "label": "Value", "help": "Needle", "width": 72 },
  "fill":  { "type": "color",  "default": "#22d3ee", "label": "Arc color" },
  "unit":  { "type": "string", "default": "%" },
  "note":  { "type": "string", "default": "", "multiline": true }
}
</script>
<div class="arc" style="--stop:calc(var(--value)*1.8deg)"></div>
<div class="readout">{{value}}{{unit}}</div>
```

- `type`: `"float" | "int" | "color" | "string"`. `default` required (synthesised per
  type if absent). Numbers take `min`/`max`/`step`; `string` takes `multiline`.
- `label` (Inspector name), `help` (explanation), `width` (control px) are optional.
- **Color values** are a literal CSS color OR a theme **tint token** `tint:<base>`
  (`tint:accent` follows the slide theme; `tint:#dc2626` a semantic tint). Tints
  resolve to a real color **per slide theme** at render (like card backgrounds).
- Splice is literal — **no logic/expressions**. Do math in CSS `calc(var(--name)*…)`.
  See `docs/html-element-variables.md`; `examples-html-elements/gauge.html` is a full
  example.

**Sandbox — what works and what doesn't.** The HTML renders in a locked-down iframe,
so the markup is contained and safe by construction:

- **No JavaScript runs.** `<script>`, inline `onclick`/`onerror`, etc. never execute.
  This element is for *static* design; if you need interactivity, use a demo.
- **No network.** An injected CSP allows only `data:` URIs — remote `<img src=http…>`,
  web fonts, and `<link>` stylesheets are blocked. **Embed images and fonts as
  `data:` URIs** (base64) directly in the HTML. This keeps decks offline-portable.
- Inline `<style>` and `style=` attributes work; CSS is scoped to the iframe (it
  can't leak onto the slide).

Editing: the Inspector has a **raw-HTML textarea** (the reliable source of truth).
Double-clicking the element on the canvas also enables **best-effort in-place
contentEditable** (a warning notes that direct editing can reshape complex markup).
Inserted from the native **Insert → HTML Element** menu (intentionally not a toolbar
button) or by writing the element JSON directly, as above.

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

**Typical layout guidelines** (all on the 30px grid, 60px outer margin):
- Title at top: `y: 60`, full width: `x: 60, width: 1800, height: 180`
- Body text flush below title: `y: 240`, grows down to the footnote
- Footnote area: `y: 990, height: 30` (tight; bottom-aligned on the 60px margin)
- Centered content: `x: 150-360` with `width: 1200-1620`
- Side margins: at least 60px (2 grid cells)

## Generating UUIDs

Every `id` must be unique. Use UUID v4 format:
`"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"`

## Example: Complete Slide

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
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
      "position": { "x": 80, "y": 1040, "width": 1000, "height": 40 },
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
9. **Test by RE-OPENING** the file in Eigendeck (or a fresh CLI / e2e session)
   after editing — not by trusting a live editor view. The in-memory editor can
   look correct while nothing was written to disk.

## Pitfalls (learned the hard way)

- **Build/repair decks with `eigendeck-cli import json`, not by scripting the
  running editor.** Driving the app headlessly (`store.addElement(...)` then
  `save()`) does NOT reliably persist — the editor's flush only writes changes
  its store-subscription tracked, so programmatic bulk adds get silently dropped
  and the saved deck opens **blank** (assets present, slides empty). `import
  json` builds the deck deterministically in one shot.
- **Verify, don't assume.** After building, inspect the saved file:
  `eigendeck-cli <deck> info` / `list slides`, or python/sqlite3
  `select type,count(*) from elements where valid_to is null group by type`.
  "Looks right in the editor" ≠ "written to the file."
- **Demo/image bytes must travel in the JSON** as an `assets[]` array
  (`{assetId, data:<base64>, mime, path}`); elements reference them by `assetId`.
  Plain `export json` omits assets — use `--with-assets`, or an imported deck has
  dangling references and demos render blank.
- **Math in a TEXT element renders in the app but NOT in the headless HTML
  export** (the export's MathJax path falls back to raw `$...$`). If an equation
  must appear in an exported deck/site, embed it as a pre-rendered **SVG image**
  element instead of `$...$` text.
- **`.eigendeck` is SQLite with a WAL.** Copy the file only after the app closes
  (or `compact` first); copying without the `-wal`/`-shm` sidecars loses
  uncommitted changes. Start from an empty deck, not a content-laden template,
  so old slides / assets / history don't ride along.
