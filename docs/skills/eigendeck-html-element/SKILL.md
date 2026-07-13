---
name: eigendeck-html-element
description: Use when the user wants a single custom-designed static (or CSS-interactive) element inside an otherwise-normal Eigendeck slide — a gradient title card, a CSS grid, an SVG diagram, a fancy table, hand-tuned typography, or arbitrary HTML/CSS that the text and image elements can't express. Covers the raw-HTML "escape hatch" element: its fields (html, background, interactive, scaleMode/scaleW/scaleH, position) and its sandbox (no JavaScript, no network — motion via CSS @keyframes, interactivity via native controls, images/fonts as data: URIs). For a whole designer deck use frontend-slides-eigendeck; for anything needing JavaScript use eigendeck-demo.
---

# Eigendeck HTML Element

The **`html` element** is Eigendeck's raw-HTML escape hatch: a box on a slide whose
contents are arbitrary HTML/CSS. Reach for it when you want to "go wild" with custom
design or layout — gradients, CSS grids, inline SVG, tables, hand-tuned typography —
inside an otherwise normal deck.

It is **not** the text element (no rich-text presets, no LaTeX math, no bundled-font
picker) and **not** a demo (no JavaScript). It sits between them: more expressive than
text, more contained than a demo.

## When to use which element

| You want… | Use |
|---|---|
| Normal prose, bullets, a heading, inline math | **text** element (presets + `$…$` LaTeX) |
| A photo / figure / logo | **image** element (goes through the asset pipeline) |
| Custom static design: gradient card, CSS grid, SVG, table, fancy type | **`html` element** (this skill) |
| CSS-only interactivity: slider, tabs, accordion, hover-reveal | **`html` element** with `interactive: true` |
| Anything that needs JavaScript / live computation | a **demo** (`eigendeck-demo` skill) |
| A whole deck of full-bleed designer slides | **`frontend-slides-eigendeck`** skill |

## The one thing to internalize: the sandbox

The `html` element renders in a **locked-down iframe** (a `srcdoc` frame with your
markup as its `<body>`). Two hard walls, by design — the markup is contained and safe:

- **No JavaScript runs.** `<script>`, inline `onclick`/`onerror`, and every other JS
  hook never execute. This element is for *static* design. If you need scripting, use
  a demo instead.
- **No network.** An injected CSP allows only `data:` URIs. Remote `<img src="http…">`,
  web fonts (`@import` / `<link>` to Google Fonts / Fontshare), and remote `<link>`
  stylesheets are all blocked and silently fall back. Eigendeck's own bundled fonts are
  not reachable from inside the iframe either.

Inline `<style>` and `style=` attributes work fine and are scoped to the iframe (CSS
can't leak onto the slide). Design **within** these walls from the start; don't fight
them. The translation is direct:

- **Motion** → CSS `@keyframes` (they run when the element mounts).
- **Interactivity** → native controls (see `interactive` below). A whole thermometer,
  tabs, an accordion, or reveal-on-hover all work with **zero JS**.
- **Images / fonts** → embed them as `data:` URIs (base64) right in the HTML. This
  keeps the deck offline-portable. For a large photo, prefer a real Eigendeck `image`
  element layered behind the `html` element rather than a giant base64 blob.

## Fields

```json
{
  "id": "unique-uuid",
  "type": "html",
  "html": "<div style=\"display:grid;place-items:center;height:100%;font-family:system-ui\"><h1 style=\"font-size:96px;background:linear-gradient(90deg,#6366f1,#ec4899);-webkit-background-clip:text;color:transparent\">Hello</h1></div>",
  "background": "#0b1020",
  "position": { "x": 560, "y": 340, "width": 800, "height": 400 }
}
```

- **`html`** — REQUIRED. The raw HTML rendered inside the box; it becomes the `<body>`
  of the sandboxed iframe. `html,body { height: 100% }` is provided for you, so a
  full-height root layout (`height:100%`) works out of the box.
- **`background`** — optional CSS color for the box. **Omit for transparent** so the
  element composites straight onto the slide. Set it to a solid color when the design
  needs its own backdrop (and to avoid any flash before the iframe paints).
- **`interactive`** — optional boolean (default `false`). When `true`, the element
  **receives mouse events**, enabling native script-less interactivity: `<input
  type="range">`, radio/checkbox `:checked` state, `<details>`, `:hover`. It becomes
  clickable in present mode (and on the canvas, double-click enters an "interact" mode
  instead of editing). Leave it off for plain static design so the element never
  intercepts clicks meant for the slide. Interactivity is still **CSS / native-control
  only** — e.g. a radio-driven `:checked ~ .fill { height: … }` control.
- **`scaleMode`** — optional boolean (default `false`). When `true`, the content is
  scaled to **fit the box with a uniform "contain" transform** (aspect ratio preserved,
  letterboxed) — so resizing the box **grows or shrinks fixed-size markup instead of
  clipping it**. The content is laid out at its **design size** and CSS-transformed to
  fit. Use this when your markup is authored at a fixed pixel size (a diagram, a card)
  and you want the box to act like a viewport onto it.
- **`scaleW`, `scaleH`** — the design width/height (in slide px) the content is
  authored at; only used when `scaleMode` is `true`. Missing or zero → no scaling
  (renders 1:1). In the app, ticking the scale checkbox captures the box's current size
  as the design size; in JSON, set these explicitly to whatever size you authored the
  HTML for.
- **`position`** — the box in slide space. The slide canvas is **1920×1080**, origin
  top-left; `width`/`height` are in that space.

## Authoring guidance

- **Design at the box size.** Everything inside is laid out against the element's
  `position.width` × `position.height` (in slide px, on the 1920×1080 canvas). A hero
  card 800px wide means headline type around 60–100px, not 24px. If you'd rather author
  at a fixed reference size and let the box scale it, use `scaleMode` + `scaleW`/`scaleH`.
- **Full-height layout is free** — `html,body{height:100%}` is set, so `height:100%`
  (or flex / grid on the root) fills the box.
- **Keep it self-contained.** Inline `<style>`, `style=` attributes, inline `<svg>`,
  CSS gradients. Any raster image or custom font must be a `data:` URI.
- **`interactive` only when needed.** Static design slides should leave it off so they
  never swallow a click meant to advance the slide.

### Example — gradient title card (static)

`background: "#0b1020"`, `interactive` omitted:

```html
<style>
  .card {
    height: 100%;
    display: grid;
    place-content: center;
    gap: 18px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    text-align: center;
  }
  .kicker {
    font-size: 22px; letter-spacing: .35em; text-transform: uppercase;
    color: #7c86b8;
  }
  .title {
    font-size: 92px; font-weight: 800; line-height: .95; margin: 0;
    background: linear-gradient(90deg, #6366f1, #ec4899);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
</style>
<div class="card">
  <div class="kicker">Spectral Methods</div>
  <h1 class="title">Eigenvectors of the Graph Laplacian</h1>
</div>
```

### Example — CSS-only interactive control (`interactive: true`)

A three-state selector driven entirely by radio `:checked` state — no JavaScript.
Requires `"interactive": true`:

```html
<style>
  .picker { height: 100%; display: grid; place-content: center; gap: 20px;
            font-family: system-ui, sans-serif; }
  .picker input { position: absolute; opacity: 0; pointer-events: none; }
  .opts { display: flex; gap: 14px; }
  .opts label {
    padding: 14px 26px; border-radius: 12px; font-size: 26px; cursor: pointer;
    border: 2px solid #d0d5e8; color: #4a5170; user-select: none;
  }
  .out { font-size: 40px; font-weight: 700; text-align: center; color: #1e2540; }

  /* default message */
  .out::after { content: "Pick a method"; }
  /* each checked radio drives the label highlight + the readout */
  #a:checked ~ .opts label[for="a"],
  #b:checked ~ .opts label[for="b"],
  #c:checked ~ .opts label[for="c"] { border-color: #6366f1; color: #6366f1; }
  #a:checked ~ .out::after { content: "Power iteration"; }
  #b:checked ~ .out::after { content: "Lanczos"; }
  #c:checked ~ .out::after { content: "Arnoldi"; }
</style>
<div class="picker">
  <input type="radio" name="m" id="a">
  <input type="radio" name="m" id="b">
  <input type="radio" name="m" id="c">
  <div class="opts">
    <label for="a">Power</label>
    <label for="b">Lanczos</label>
    <label for="c">Arnoldi</label>
  </div>
  <div class="out"></div>
</div>
```

The same pattern (a hidden `<input>` + `:checked ~ …` sibling selectors) builds tabs,
accordions, a thermometer whose fill height changes, and toggle reveals — all offline
and script-free.

## Inserting / editing

Add an `html` element from the native **Insert → HTML Element** menu (it's intentionally
not a toolbar button), or by writing the element JSON directly into a slide's
`elements[]`. In the **Inspector** there's a raw-HTML textarea — the reliable source of
truth for the markup. Double-clicking the element on the canvas also enables best-effort
in-place `contentEditable`, with a warning that direct editing can reshape complex
markup; for anything intricate, edit the textarea.

## Common pitfalls (all from the sandbox)

- **Font looks wrong** → a remote `@import`/`<link>` was CSP-blocked and fell back to a
  system font. Use a system font stack, or embed the face as a `data:` URI.
- **Image missing** → it was a remote or file-path `src`. Inline it as a `data:` URI or
  inline `<svg>`, or use a real Eigendeck `image` element behind the `html` element.
- **Interactive widget doesn't respond** → set `"interactive": true`. In the editor,
  double-click the element to enter interact mode.
- **Anything JavaScript "doesn't work"** → nothing JS will ever run here. Re-express it
  as CSS (`@keyframes`, `:checked`, `:hover`), or move it to a demo.
- **Fixed-size markup gets clipped when the box resizes** → turn on `scaleMode` and set
  `scaleW`/`scaleH` to the size you authored at, so it scales-to-contain instead.
