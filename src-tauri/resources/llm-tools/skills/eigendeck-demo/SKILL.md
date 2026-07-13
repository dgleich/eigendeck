---
name: eigendeck-demo
description: Author an Eigendeck interactive JavaScript demo — the `demo` element: a self-contained HTML+JS visualization (canvas / SVG / WebGL / d3) embedded full-bleed or boxed in a slide, the thing that makes Eigendeck distinctive (matrix, graph, and HPC algorithm animations, step-throughs, live sliders). Use when the user wants an INTERACTIVE or ANIMATED visualization with real JavaScript on a slide — sliders that recompute, a force layout, a stepped algorithm, a shader. For STATIC design HTML with no JavaScript use `eigendeck-html-element`; to put a finished demo file into a deck use `eigendeck-cli`. Encodes the mount marker, the offline-by-default network manifest, the `--eigendeck-*` theme variables, and the injected host bridge (patched hash / BroadcastChannel relay / parent-driven rAF).
---

# Eigendeck Interactive Demos

A **demo** is a single self-contained `.html` file — inline CSS + JavaScript — that
Eigendeck mounts in a sandboxed iframe over a slide (full-bleed or boxed). This is
the element that runs *real JavaScript*: canvas / SVG / WebGL / d3 visualizations,
sliders that recompute, stepped algorithms, force layouts. If your slide needs no
JavaScript (a static design slide, CSS-only motion), use `eigendeck-html-element`
instead — it's a stricter, script-less sandbox.

You author **one `.html` file**. Everything below is what that file must contain to
mount, match the slide theme, and (if needed) reach the network.

## The mount marker (required, exact bytes)

A demo file **must** be HTML that begins with the marker
`<!--eigendeck-demo-v1-->`, placed **immediately after** `<!DOCTYPE html>`:

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html> …
```

This is the mount gate — an unmarked file is **refused** and never renders as a
demo (DEMO_AUTHORING.md → "Required: the eigendeck demo marker"; DEMO_SPEC.md →
"Required marker"). Rules (DEMO_AUTHORING.md):

- **Exact bytes, ASCII, lowercase:** `<!--eigendeck-demo-v1-->`. It's an HTML
  comment, so it never renders.
- **Position:** first meaningful line after `<!DOCTYPE html>` (an optional UTF-8
  BOM and whitespace before the DOCTYPE are tolerated).
- **Versioned:** `v1`. A newer, unknown version is treated as "not a demo I can
  run" rather than assumed safe.

The marker is re-checked on the bytes at *every* point HTML enters the pipeline
(adding, mounting, watching an external file), so you can't turn an arbitrary web
page into a demo — it must be built as an eigendeck demo.

## Self-contained + offline by default

**Inline your CSS and JavaScript.** A demo is **offline by default** — with no
manifest it cannot `fetch`/XHR/WebSocket, and it cannot load a **remote
`<script src>` / `<link>` stylesheet / image / font** either. If you pull a
library from a CDN (d3, Plotly, topojson, …) and don't declare that CDN's host,
the library never loads and **the demo renders blank** (DEMO_AUTHORING.md →
"Internet access"). Vendoring a library inline (paste it into a `<script>`) is the
robust default: it works even when the viewer has blocked internet.

### The network manifest (only if you need the network)

To reach any host, declare it (and *why*) in an `application/eigendeck-manifest+json`
`<script>` in the `<head>` — the exact shape from DEMO_AUTHORING.md:

```html
<head>
<meta charset="utf-8">
<script type="application/eigendeck-manifest+json">
{ "network": [
  { "host": "api.stockdata.example", "purpose": "Live stock quotes" },
  { "host": "cdn.plot.ly",           "purpose": "Plotly charting library" }
] }
</script>
…
```

- **Declared ≠ granted, and scoped.** The hosts you list become the demo's
  allowlist. A demo that declares `api.stockdata.example` but reaches
  `tracker.example` is **blocked** — only declared hosts get through.
- **`host`** is a bare hostname (`api.example.com`), allowed over `https` and
  secure WebSocket (`wss`). For a non-default scheme/port (a local dev server)
  give a full origin: `"http://localhost:8888"`.
- **`purpose`** is shown to the person opening the deck (Security window → Internet
  tab). Write it for them ("Live stock quotes"), not for yourself — it's how they
  decide if your demo phoning home is legitimate.
- **The viewer stays in control.** They can block internet for one deck or for
  every deck; either overrides your manifest. **Design demos to degrade gracefully
  offline.**

## Theme: read the injected `--eigendeck-*` variables (never hardcode)

Eigendeck splices the resolved theme into your demo bytes **at mount**, as CSS
custom properties on `:root`, plus data-URL `@font-face` rules for the slide's
fonts. Read them (with a fallback for standalone) so the demo matches any theme —
light or dark — automatically. The full documented set (DEMO_AUTHORING.md →
"When you DO need theme colors"):

| Variable | What |
|---|---|
| `--eigendeck-bg` | slide background |
| `--eigendeck-fg` | body text color |
| `--eigendeck-heading` | title color |
| `--eigendeck-accent` | accent / annotation color |
| `--eigendeck-muted` | muted / footnote color |
| `--eigendeck-font` | body font family (e.g. `'PT Sans'`) |
| `--eigendeck-narrow` | narrow variant (falls back to the body font) |
| `--eigendeck-mono` | monospace / code font family |
| `--eigendeck-base-size` | deck body font size (px) |

Rules that make theming actually work (DEMO_AUTHORING.md → "Matching the deck"):

1. **Don't paint a background.** A demo iframe is transparent — if you *don't* set
   `background` on `html`/`body`/your container, the **slide background shows
   through** and matches every theme for free. Only set a background when you must
   *cover* slide content or guarantee contrast for a busy visualization.
2. **Track the theme, don't hardcode colors.** Color text/UI/canvas-chrome with
   `var(--eigendeck-fg, #333)` (or `--eigendeck-muted` for secondary). A hardcoded
   dark color **disappears on a dark slide** — the single most common mistake.
   Data-driven colors (heatmaps, category palettes) can stay fixed; only the
   *chrome* (nodes, axes, gridlines, labels, control text) must track the theme.
   Set `accent-color: var(--eigendeck-accent, …)` on range/checkbox inputs.
3. **Size text in `em` off the deck base size — never hardcode px.** A demo renders
   in the slide's coordinate space where body text is `--eigendeck-base-size`
   (commonly 28–40px), so hardcoded px fonts come out tiny. Set the demo root's
   `font-size` to the base size and express everything else in `em`:
   ```css
   .mydemo-root {
     font-size: var(--eigendeck-base-size, 20px);   /* 1em == deck body text */
     font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
     color: var(--eigendeck-fg, #222);
   }
   .mydemo-value { font-size: 3em; }   /* a hero number */
   .mydemo-cap   { font-size: 0.85em; }
   ```
4. **Canvas / WebGL can't read a CSS var directly** — pull it in JS and use it:
   ```js
   const fg = getComputedStyle(document.documentElement)
     .getPropertyValue('--eigendeck-fg').trim() || '#334155';
   ctx.fillStyle = fg;   // nodes / labels / axes now follow the theme
   ```
5. **Font decode is async.** A demo that draws text to canvas or WebGL on its first
   paint should `await document.fonts.ready` before painting, or the first frame
   renders in a fallback face.

> A theme switch **re-mounts** the demo (the blob is rebuilt with the new vars),
> so **in-demo JS state is lost across a theme change** — but the vars are always
> correct for the theme the demo mounts under. Read them at init (CSS `var()` or
> `getComputedStyle`); no live theme-watcher is needed.

## The host bridge (injected — you don't build it)

Demos run in an **opaque-origin sandbox** (`sandbox="allow-scripts"`, no
`allow-same-origin`). A demo therefore **cannot** reach `window.top` /
`window.parent` / the app / Tauri, and has no `localStorage` / `sessionStorage` /
`cookies` / `IndexedDB` (DEMO_SPEC.md; DEMO-PLATFORM.md §3). In every context —
editor, presenter, HTML export — Eigendeck injects a **bridge `<script>` before
your code** that transparently provides (DEMO_AUTHORING.md → "How Eigendeck Loads
Demos"):

1. **`location.hash` + `URLSearchParams`** — the raw hash is empty in a sandboxed
   iframe; the bridge supplies the correct `role` / `piece` params.
2. **`BroadcastChannel`** — patched into a per-instance **relay through the
   parent** (see multi-piece below), so demos on different slides don't collide.
3. **Parent-driven `requestAnimationFrame`** — the parent runs one un-throttled
   60fps pump and clocks your `rAF` callbacks off it, so animations aren't capped
   to the ~30fps WebKit imposes on un-interacted cross-origin iframes
   (DEMO-PLATFORM.md §16). **You keep calling `requestAnimationFrame` normally** —
   no change needed. (Ambient animation before any click may still be ~30fps; a
   real click on the demo un-throttles it.)
4. **Error forwarding** — the demo's `console.error` / `console.warn` and uncaught
   errors are forwarded to Eigendeck's built-in debug console (the primary channel,
   since the iframe is its own origin).

**You don't handle any of this.** Just use the standard patterns:
```js
const params = new URLSearchParams(location.hash.slice(1));
const channel = new BroadcastChannel('eigendeck-demo:mydemo.html');
```
Hardcode a filename for the channel name; don't use `location.pathname` (empty in
the sandbox).

## Single-file vs multi-piece

There are two flavors (DEMO_AUTHORING.md, opening note):

- **Single self-contained demo** — one file, one canvas/DOM view, no message
  protocol. The common case: a slider that recomputes, an animation, a stepped
  algorithm all in one region. **Start here.** See the starter below.
- **Multi-piece demo** — a hidden **controller** iframe (owns state, runs the
  simulation) plus one or more visible **piece** viewports, wired over
  `BroadcastChannel`. Use when you want independently positioned regions (a graph
  next to a stats panel next to controls) that share one state. The controller
  broadcasts `{type:'state', …}`; viewports render from it and forward
  interactions. Full worked pattern, the message protocol, and how pieces
  auto-appear on a slide are in **[starter.md](starter.md)**.

## Minimal correct starter (single-file, reads a theme var)

This mounts, paints on the transparent slide background, tracks the theme, sizes in
`em`, and animates via `requestAnimationFrame` (clocked by the bridge). Faithful to
DEMO_AUTHORING.md's rules.

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }      /* REQUIRED: iframe needs explicit height */
  /* no background → the slide shows through and matches any theme */
  .pulse-root {
    width: 100%; height: 100%;
    font-size: var(--eigendeck-base-size, 20px);  /* 1em == deck body text */
    font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
    color: var(--eigendeck-fg, #222);
    display: flex; align-items: center; justify-content: center;
  }
</style>
<script>
(function () {
  function start() {
    const root = document.createElement('div');
    root.className = 'pulse-root';
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);
    document.body.appendChild(root);
    const ctx = canvas.getContext('2d');

    function size() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = root.clientWidth  * dpr;
      canvas.height = root.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener('resize', size);

    let t = 0;
    function draw() {
      // read theme colors each frame so they always track the slide
      const cs = getComputedStyle(document.documentElement);
      const accent = cs.getPropertyValue('--eigendeck-accent').trim() || '#2563eb';
      const fg     = cs.getPropertyValue('--eigendeck-fg').trim()     || '#334155';
      const w = root.clientWidth, h = root.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const r = 40 + 24 * Math.sin(t / 30);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = '1.2em ' + (cs.getPropertyValue('--eigendeck-font').trim() || 'sans-serif');
      ctx.textAlign = 'center';
      ctx.fillText('r = ' + r.toFixed(1), w / 2, h / 2 + 100);
      t++;
      requestAnimationFrame(draw);       // bridge clocks this at the parent's full rate
    }
    // fonts decode async — wait before the first canvas paint
    document.fonts.ready.then(() => requestAnimationFrame(draw));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
</script>
</head>
<body></body>
</html>
```

Critical rules baked in above (DEMO_AUTHORING.md → "Critical Rules"):
`html, body { width:100%; height:100% }` (else the iframe collapses to zero
height); guard on `document.readyState` before `DOMContentLoaded` (the script may
run after the DOM is ready); prefix your CSS classes (`pulse-`) to avoid clashing
with other demos or the app UI; wrap everything in an IIFE to keep the global scope
clean.

## Putting a demo into a deck

The app stores the demo HTML as an **asset**, and a slide's `demo` element points
at it (a `demo-piece` element carries `demoSrc` + a `piece` name; DEMO_SPEC.md →
"Data Model"). In the app you add a demo by dropping / importing the `.html` onto a
slide, and Eigendeck scans the file for your `piece === '...'` checks to
auto-create the piece element(s). To do the store-asset → import round-trip
**from the command line** (build a deck programmatically with an embedded demo
asset), use the **`eigendeck-cli`** skill — it covers the full JSON round-trip for
decks with embedded demo/image assets.

## Debugging

- Uncaught errors and `console.error` / `console.warn` are forwarded to Eigendeck's
  built-in debug console — the primary channel, since the demo is its own origin.
- The no-hash / standalone path lets you open the bare `.html` directly in a
  browser while iterating (CSS `var()` fallbacks apply, `BroadcastChannel` is
  native). For a single-file demo the code above already runs standalone. For a
  multi-piece demo, wire a real no-hash branch (call your generator + renderer
  in-process) so the bare file isn't blank — see **[starter.md](starter.md)**.

## Related skills

- **`eigendeck-html-element`** — a *static*, script-less, offline custom-HTML slide
  element (CSS-only motion, native controls). Use it when you don't need
  JavaScript; use a `demo` (this skill) when you do.
- **`eigendeck-cli`** — build / inspect / edit `.eigendeck` decks from the command
  line, including the store-asset → import round-trip that puts a finished demo
  file into a deck.
