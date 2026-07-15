# Building Eigendeck Demo Pieces — Guide for LLMs and Tools

This guide explains how to create interactive demos that integrate as positionable pieces in Eigendeck presentations.

> **Two flavors of demo.** This guide covers **multi-piece demos** — a controller
> + viewport iframes wired over `BroadcastChannel`. The other flavor is a
> **single self-contained `.html`** (one canvas, no message protocol) — the kind
> in `example-demos/showcase/`. Both share the theme/sizing/dark-slide rules
> below. For the self-contained recipe — the shared skeleton, the slide-matched
> control kit (sliders/segmented buttons/lists/thumbnail strips), and a catalog of
> ~12 worked examples — see **`example-demos/showcase/README.md`**.

## Architecture

A demo is a single HTML file that serves three roles based on URL hash:

```
#role=controller  → Hidden iframe, runs logic/simulation, broadcasts state
#piece=graph      → Visible iframe, renders the "graph" piece
#piece=stats      → Visible iframe, renders the "stats" piece
(no hash)         → Standalone dev preview — open the .html directly while developing
                    (you render it; see "Standalone / dev preview" below)
```

All communication between controller and viewports uses `BroadcastChannel`.

Demos run in an **opaque-origin sandbox** — no access to the app, Tauri,
`window.top`/`window.parent`, and no `localStorage`/`sessionStorage`/`cookies`/
`IndexedDB` (see "Isolation — what a demo cannot do" below). The
`BroadcastChannel` you use is **not** a native same-origin channel: an
app-injected bridge **relays** it through the parent, keyed per demo instance.
A demo is **offline by default**; to reach the internet it must declare the
hosts it needs in a manifest (see "Internet access" below).

**Piece names** can be any string of letters, digits, `_`, and `-`
(e.g. `graph`, `force-graph`, `bar-chart-2`). When you add a demo to a slide,
Eigendeck **scans the HTML for your `piece === '...'` checks and auto-creates a
piece element for each unique name** (as long as the file also uses
`BroadcastChannel`) — so you just write the branches and the pieces appear. See
`DEMO_SPEC.md` for the data model.

## Required: the eigendeck demo marker

Every demo **must** begin with the marker `<!--eigendeck-demo-v1-->`, placed
**immediately after the DOCTYPE**:

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html> …
```

This is not optional decoration — it is how Eigendeck knows a file is a demo it
authored, and it is enforced at **every** point HTML enters the demo pipeline:

- **Adding a demo** — Eigendeck refuses to add an `.html` file as a demo unless it
  carries the marker. You cannot turn an arbitrary web page into a demo; it must be
  built as an eigendeck demo (this guide).
- **Mounting/rendering** — demo bytes are re-checked before they are mounted, so a
  deck can never render non-demo HTML as a demo.
- **Watching an external demo file** — the same check runs on the file on disk
  (fully resolved), so a *watched* demo path that doesn't resolve to a real marked
  demo is refused. This is what stops a shared deck from pointing a "demo" at one of
  your private files.

Rules for the marker:

- **Exact bytes, ASCII, lowercase:** `<!--eigendeck-demo-v1-->`. It's an HTML
  comment, so it never renders.
- **Position:** first meaningful line after `<!DOCTYPE html>` (an optional UTF-8 BOM
  and whitespace before the DOCTYPE are tolerated). Putting it after the DOCTYPE
  keeps the document in standards mode in every load context.
- **Versioned:** the `v1` lets the format evolve. Eigendeck accepts marker versions
  it understands; a newer, unknown version is treated as "not a demo I can run"
  rather than assumed safe.
- **The build/injection pipeline preserves it:** vendored-library injection
  (`/* __D3FORCE__ */` etc.) happens in the body, never the head, so it never
  disturbs the marker. Tools that generate demos (`build-showcase.mjs`, any "new
  demo" template) must emit it.

## Internet access

A demo is **offline by default**. If it needs the network (a data API, a CDN
library, a tile server), it must **declare each host and why** in a manifest —
a JSON `<script>` in the `<head>`:

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

- **Declared ≠ granted, and scoped:** the hosts you list become the demo's
  allowlist. A demo that declares `api.stockdata.example` but then tries to
  reach `tracker.example` is **blocked** — only declared hosts get through.
- **`host`** is a bare hostname (`api.example.com`) — Eigendeck allows it over
  `https` and secure WebSocket (`wss`). For a non-default scheme/port (a local
  dev server) give a full origin: `"http://localhost:8888"`.
- **`purpose`** is shown to the person opening the deck, in the security window's
  Internet tab, next to the host. Write it for them ("Live stock quotes"), not
  for yourself. It's how they decide whether your demo's phoning-home is
  legitimate.
- **No manifest → no internet — and a CDN demo goes BLANK.** With no manifest a
  demo can't fetch, open a socket, load a remote image/font/stylesheet, *or load a
  remote `<script src>`*. So if your demo pulls a library from a CDN (D3, Plotly,
  topojson, …) and you don't declare that CDN's host, the library never loads and
  the demo renders blank. **Declare every host you load from.** (Deck authors: run
  `uv run tools/demo_manifests.py check <deck>.eigendeck` to catch demos that load a
  CDN without declaring it; `fix` injects the manifest.)
- **The person opening the deck stays in control.** They can block internet for
  one deck (security window) or for every deck (Settings → Security); either
  overrides your manifest. Design demos to degrade gracefully offline.

> The gate covers everything: `fetch`/XHR/WebSocket/beacon, remote images, media,
> fonts, form submission, **and remote `<script src>` / `<link>` stylesheets**. A
> CDN library (D3, Plotly, …) loads only if you declare its host — so declare every
> host you load from. Vendoring a library inline is still nice (works even when the
> viewer blocks internet), but no longer required just to run.

## WebAssembly (Pyodide, GeoGebra, Emscripten/Rust/Go…)

**WebAssembly works** — the demo CSP allows `'wasm-unsafe-eval'` (wasm compilation
only, not JS `eval`), so `WebAssembly.instantiate` runs inside the sandbox. You
still have to get the `.wasm` *bytes* the same way as any resource:

- **Offline (recommended):** embed the module — base64 → `Uint8Array` →
  `WebAssembly.instantiate(bytes)`. No manifest needed; runs even when the viewer
  blocks internet.
- **From a CDN:** `WebAssembly.instantiateStreaming(fetch(url))` is a network load,
  so **declare that host in the manifest** (e.g. `cdn.jsdelivr.net` for Pyodide),
  and expect it to go blank if the viewer has internet off.

Threads/SharedArrayBuffer (cross-origin isolation) aren't available in the sandbox,
so ship single-threaded wasm builds.

## Template

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html>
<head>
<meta charset="utf-8">
<style>
/* REQUIRED: html/body must have explicit height for iframes */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; }
body { font-family: 'PT Sans', system-ui, sans-serif; overflow: hidden; }

/* PREFIX all styles with a unique demo name to avoid conflicts */
.mydemo-main { width: 100%; height: 100%; background: #fafafa; }
.mydemo-panel { width: 100%; height: 100%; padding: 20px; overflow-y: auto; }
</style>

<!-- External libraries (CDN) — loaded before your script -->
<!-- <script src="https://d3js.org/d3.v7.min.js"></script> -->

<script>
(function() {
  // ============================================
  // 1. Parse role from URL hash
  // ============================================
  const params = new URLSearchParams(location.hash.slice(1));
  const role = params.get('role');
  const piece = params.get('piece');

  // Channel name: hardcode the filename for uniqueness (works in all contexts)
  const channelName = 'eigendeck-demo:mydemo.html';
  const channel = new BroadcastChannel(channelName);

  // ============================================
  // 2. Controller (hidden, persistent)
  // ============================================
  if (role === 'controller') {
    // --- Initialize state ---
    let myState = { /* ... */ };

    // --- Broadcast state to all viewports ---
    function broadcastState() {
      channel.postMessage({ type: 'state', ...myState });
    }

    // --- Listen for viewport interactions ---
    channel.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'request-state') {
        broadcastState();
      }
      // Handle other interaction messages...
    };

    // --- Initial broadcast ---
    setTimeout(() => broadcastState(), 50);

    // --- Hide controller body ---
    if (document.body) document.body.style.display = 'none';
    else document.addEventListener('DOMContentLoaded', () => {
      document.body.style.display = 'none';
    });
    return;
  }

  // ============================================
  // 3. Viewport: main piece
  // ============================================
  if (piece === 'main') {
    const setup = () => {
      const container = document.createElement('div');
      container.className = 'mydemo-main';
      document.body.appendChild(container);

      // --- Render from state ---
      function renderFromState(state) {
        // Update the DOM based on state...
      }

      // --- Forward interactions to controller ---
      container.addEventListener('click', (e) => {
        channel.postMessage({ type: 'click', /* data */ });
      });

      // --- Listen for state updates ---
      channel.onmessage = (e) => {
        if (e.data.type === 'state') renderFromState(e.data);
      };

      // --- Request initial state ---
      channel.postMessage({ type: 'request-state' });
    };

    // Handle DOMContentLoaded race condition
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }
    return;
  }

  // ============================================
  // 4. Viewport: panel piece
  // ============================================
  if (piece === 'panel') {
    const setup = () => {
      const container = document.createElement('div');
      container.className = 'mydemo-panel';
      document.body.appendChild(container);

      function renderFromState(state) {
        container.innerHTML = '...'; // Update from state
      }

      channel.onmessage = (e) => {
        if (e.data.type === 'state') renderFromState(e.data);
      };

      channel.postMessage({ type: 'request-state' });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }
    return;
  }

  // ============================================
  // 5. Standalone fallback (no hash) — see "Standalone / dev preview" below.
  //    Eigendeck never loads this path; it's purely so you can open the .html
  //    DIRECTLY in a browser while developing. Make it actually run the demo
  //    (drive the main piece from the controller logic in-process), not a dead
  //    "open in Eigendeck" message — otherwise the file looks blank/broken when
  //    you double-click it, which is confusing while iterating.
  document.addEventListener('DOMContentLoaded', () => {
    // dev preview: reuse the same sim + render you wrote above, no BroadcastChannel
    const state = generateState();          // the controller's generator
    renderFromState(state);                 // the main piece's renderer
  });
})();
</script>
</head>
<body></body>
</html>
```

### Standalone / dev preview (the no-hash branch)

A demo-piece file runs **four** ways: `#role=controller`, `#piece=<name>` (one per
piece), and **no hash at all**. Eigendeck only ever loads the first three — it always
appends a hash. The no-hash branch exists **for you**: so you can double-click the
`.html` (or `open` it) and see the demo while developing, without the Eigendeck
harness, a dev server, or BroadcastChannel.

- **Make it real.** Have the no-hash branch actually render the demo — call the same
  generator + renderer your controller/piece use, wired together in-process (skip
  BroadcastChannel; just call the functions). That's your fast iterate-in-a-browser
  loop. A placeholder like `"Open in Eigendeck"` defeats the purpose.
- **It's a convenience, not a requirement.** Omitting the branch does NOT break the
  demo inside Eigendeck (it loads the hashed pieces) — it just means the bare file
  renders **blank** when opened directly. So if a teammate says "your demo shows
  nothing when I open it," that's the missing no-hash branch, not an Eigendeck bug.
- **Factor for reuse.** Keep the simulation (`generateState`) and each piece's
  `renderFromState` as named functions at the top of the IIFE so all four branches
  (controller, pieces, standalone) can share them instead of duplicating logic.

## How Eigendeck Loads Demos

Demos run in three contexts, all **opaque-origin** and all handled
automatically. None of them get `location.hash` or `BroadcastChannel` natively —
an app-injected **bridge** provides them in **every** context:

| Context | `location.hash` (role/piece) | `BroadcastChannel` |
|---------|------------------------------|---------------------|
| **Editor** | Provided by the bridge | Provided by the bridge |
| **Presenter** | Provided by the bridge | Provided by the bridge |
| **HTML Export** | Provided by the bridge | Provided by the bridge |

In every context Eigendeck injects a bridge `<script>` before your code that:
1. Patches `URLSearchParams` + `location.hash` — supplies the correct
   piece/role params (the raw `location.hash` is empty in a sandboxed iframe).
2. Patches `BroadcastChannel` — keyed per demo instance, so it relays through the
   parent and demos on different slides don't collide.
3. Parent-drives `requestAnimationFrame` — the parent runs an un-throttled 60fps
   pump, so your animations aren't capped to the ~30fps WebKit imposes on
   cross-origin iframes.
4. Forwards demo errors + `console.error`/`console.warn` to the app's debug
   console.

**You don't need to handle any of this.** Just use the standard pattern:
```js
const params = new URLSearchParams(location.hash.slice(1));
const channel = new BroadcastChannel('eigendeck-demo:mydemo.html');
```
Use a hardcoded filename for the channel name; the bridge does the rest.

### Isolation — what a demo cannot do

The opaque-origin sandbox is a hard boundary. A demo **cannot**:

- reach `window.top` / `window.parent` / the app / Tauri;
- use `localStorage` / `sessionStorage` / `cookies` / `IndexedDB`;
- `fetch` same-origin or app URLs;
- reach the internet at all unless it **declares the hosts** in its manifest
  (see "Internet access" above) — and even then only the declared hosts, and
  only if the person opening the deck hasn't switched internet off.

And remember the channel is a relay: **payloads are structured-clone only**
(plain data — no functions/DOM/class instances), and you should **not stream at
~60fps across pieces** (broadcast state changes; run `requestAnimationFrame`
locally in each viewport).

## Matching the deck — fonts & theme

A demo runs in an isolated iframe over the slide. Two rules make it match the
deck automatically — the most important one is **don't paint a background**.

1. **Don't set a background — let it be transparent.** A demo iframe is
   transparent, so if you DON'T set `background` on `html`/`body` (or your
   full-size container), the **slide's background shows straight through**. That's
   automatic background matching on every theme, with zero CSS and no fallback to
   keep in sync. Only set a background when you specifically need to *cover* slide
   content behind the demo, or to guarantee contrast for a busy visualization.

2. **Fonts resolve automatically.** Eigendeck splices data-URL `@font-face`
   rules for the deck's fonts into the demo bytes at mount (editor, presenter,
   export), scoped to the slide's fonts, so `font-family: 'PT Sans'` (or whatever
   the slide uses) just works — no change needed. For text drawn over the
   transparent background, set `color: var(--eigendeck-fg, #222)` so it stays
   readable on light AND dark slides.

   > Font decode is **async**. A demo that draws text to canvas or WebGL on its
   > first paint should `await document.fonts.ready` before painting, or the
   > first frame renders in a fallback face.

   ```css
   body {
     /* no background → the slide shows through and matches any theme */
     color: var(--eigendeck-fg, #222);
     font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
   }
   ```

### Size text relative to the deck — never hardcode px

A demo renders in the slide's coordinate space, where body text is
`--eigendeck-base-size` (commonly 28–40px), not the 14–16px that looks right in a
browser tab or the editor's zoomed canvas. Hardcoded px font sizes therefore come
out tiny next to the slide's own text. **Rule: set the demo root's `font-size` to
the deck base size and express everything else in `em`.**

```css
.mydemo-root {
  font-size: var(--eigendeck-base-size, 20px);   /* 1em == deck body text */
  font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
  color: var(--eigendeck-fg, #222);
}
.mydemo-title { font-size: 1.1em; }
.mydemo-value { font-size: 3em; }      /* a "hero" number */
.mydemo-cap   { font-size: 0.85em; }   /* footnote */
```

- Body-sized UI text is `1em` and matches the slide automatically. The base size
  is spliced in **at mount**; if the deck theme or base size changes, the demo is
  **re-mounted** with the new value (see the theme note below), so it always
  reflects the theme the demo mounts under.
- For SVG `<text>`, the same idea: use `em` in CSS (it inherits the element font),
  or read the base size in JS for attribute-based sizing:
  ```js
  const base = parseFloat(getComputedStyle(document.documentElement)
                 .getPropertyValue('--eigendeck-base-size')) || 20;
  label.setAttribute('font-size', 0.9 * base);
  ```
- SVG geometry (stroke widths, marker radii, gridlines) is already in slide units,
  so it stays consistent across screens — it's only eyeballed px **font** sizes
  that drift.
- **Preview at real slide scale** (presenter view or an HTML export), not the
  editor's zoomed canvas, which makes undersized text look acceptable.

### When you DO need theme colors

The resolved theme is also injected as CSS custom properties — use them when a
demo needs an explicit background, text/stroke colors, or sizing that tracks the
deck (with a fallback so it still works opened standalone):

| Variable | What |
|---|---|
| `--eigendeck-bg` | slide background |
| `--eigendeck-fg` | body text color |
| `--eigendeck-heading` | title color |
| `--eigendeck-accent` | accent / annotation color |
| `--eigendeck-muted` | muted / footnote color |
| `--eigendeck-font` | body font family (e.g. `'PT Sans'`) |
| `--eigendeck-narrow` | narrow variant (falls back to the body font) |
| `--eigendeck-mono` | monospace/code font family |
| `--eigendeck-base-size` | deck body font size (px) |

The vars are spliced into the demo bytes **at mount**, not written live. A theme
switch **re-mounts** the demo (the blob is rebuilt) — so **in-demo JS state is
lost** across a theme change — but the vars are always correct for the theme the
demo mounts under. Read them via `var(--eigendeck-*, fallback)` in CSS, or via
`getComputedStyle` at init in JS, and a demo authored against them matches
dark/light themes for free. You can also read or change them programmatically for
dynamic effects, e.g.

```js
const fg = getComputedStyle(document.documentElement).getPropertyValue('--eigendeck-fg').trim();
// d3 strokes that follow the theme:  .attr('stroke', 'var(--eigendeck-fg)')
// or drive your own:  document.documentElement.style.setProperty('--my-color', fg);
```

### Controls, labels & canvas text must survive a DARK slide

This is the most common theming mistake: a demo looks fine on the default white
deck, then **disappears on a dark theme** because its text/UI colors are
hardcoded dark. The slide background is transparent and can be anything, so:

- **Never hardcode a dark (or light) text color.** Slider labels, value
  readouts, checkbox captions, legends — color them `var(--eigendeck-fg, #333)`
  (or `--eigendeck-muted` for secondary text). A hardcoded `#334155` is invisible
  on a dark slide.
- **Form controls:** set `accent-color: var(--eigendeck-accent, …)` on
  `range`/`checkbox` inputs, and give a `range` track an explicit translucent
  fill so the groove shows on any backdrop (the browser default is near-invisible
  on dark):
  ```css
  input[type=range] {
    accent-color: var(--eigendeck-accent, #6366f1);
    background: color-mix(in srgb, var(--eigendeck-fg, #333) 22%, transparent);
    border-radius: 5px;
  }
  label, .value { color: var(--eigendeck-fg, #333); }
  ```
- **Canvas drawing:** `ctx.fillStyle`/`strokeStyle` can't read a CSS var directly
  — pull it once per draw and use it for nodes, axes, and text labels:
  ```js
  const fg = getComputedStyle(document.documentElement)
    .getPropertyValue('--eigendeck-fg').trim() || '#334155';
  ctx.fillStyle = fg;   // nodes / labels now follow the theme
  ```
  Reading it inside the draw function (not once at startup) keeps it correct if
  the var is ever updated within the mount. (A full theme switch re-mounts the
  demo, so init-time reads are already correct for the new theme.) Data-driven
  colors (heatmaps, category palettes) can
  stay fixed — only the *chrome* (nodes, axes, gridlines, labels) needs to track
  the theme.

See `demo-starter.html` (from **File → Install LLM Tools**) for the pattern, and
`example-demos/magnetic-powers/demos/harper_electron.html` for a worked example
(theme-aware sliders + canvas).

## Critical Rules

1. **`html, body { width: 100%; height: 100%; }`** — Without this, iframe content collapses to zero height.

2. **Check `document.readyState`** before registering `DOMContentLoaded`:
   ```js
   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', setup);
   } else {
     setup();
   }
   ```
   The script may run after the DOM is already loaded.

3. **Hide controller body** — The controller iframe is 0x0 pixels but still runs. Hide its body:
   ```js
   if (document.body) document.body.style.display = 'none';
   else document.addEventListener('DOMContentLoaded', () => { document.body.style.display = 'none'; });
   ```

4. **Request initial state on viewport load** — The controller may have already broadcast before the viewport loaded:
   ```js
   channel.postMessage({ type: 'request-state' });
   ```

5. **Prefix all CSS** with a unique name (`mydemo-`, `ge-`, etc.) to avoid conflicts with other demos or the Eigendeck UI.

6. **Wrap everything in an IIFE** — `(function() { ... })();` — to avoid polluting the global scope.

7. **Channel name must match** — Hardcode your demo's filename:
   ```js
   const channelName = 'eigendeck-demo:mydemo.html';
   ```
   Don't use `location.pathname` — it's empty in srcdoc iframes (HTML export).

8. **Controller broadcasts, viewports listen** — Never have viewports broadcast state. Only the controller owns state.

## Message Protocol

### Controller → Viewports

```js
// State update (broadcast on every change)
{ type: 'state', ...stateFields }
```

### Viewports → Controller

```js
// Request current state
{ type: 'request-state' }

// User interaction
{ type: 'click-item', itemId: 3 }
{ type: 'drag-item', itemId: 3, x: 150, y: 200, phase: 'start'|'drag'|'end' }
{ type: 'clear-selection' }
{ type: 'set-parameter', name: 'speed', value: 0.5 }
```

## Presentation JSON

Each piece is a `demo-piece` element:

```json
{
  "type": "demo-piece",
  "demoSrc": "demos/my-demo.html",
  "piece": "main",
  "position": { "x": 80, "y": 240, "width": 900, "height": 650 }
}
```

Multiple pieces from the same demo on the same slide:
```json
[
  { "type": "demo-piece", "demoSrc": "demos/my-demo.html", "piece": "main", ... },
  { "type": "demo-piece", "demoSrc": "demos/my-demo.html", "piece": "panel", ... }
]
```

Eigendeck automatically creates a hidden controller iframe for each unique `demoSrc` on the slide.

## Progressive Reveal (Build Slides)

Show different pieces on consecutive slides within a group:

- Slide 1: only `main` piece
- Slide 2 (build): `main` + `panel` pieces
- Slide 3 (build): `main` + `panel` + `controls` pieces

Use `linkId` to animate pieces between slides. Use `syncId` to keep pieces in sync.

## Common Patterns

### D3 Force Graph
- Controller: run `d3.forceSimulation` headlessly, broadcast node positions
- Graph viewport: render SVG from positions, forward click/drag events
- See `examples/graph-explorer/demos/graph-explorer.html`

### Interactive Controls
- Controller: manage parameter state
- Controls viewport: render sliders/buttons, forward changes to controller
- Visualization viewport: render from controller state

### Optional: a slide-matched control kit (steal from the showcase)

These are **suggestions, not requirements** — a demo works with any HTML. But the
`example-demos/showcase/demos/*.html` demos share a small set of controls that
read well on a slide (they're HTML overlaid on the canvas, styled to feel like the
deck rather than browser-default widgets). Copy whichever you like. All use the
theme vars with fallbacks (so they track the slide theme and survive a dark
slide), and size in `em` (relative to the deck), never hardcoded `px`. Each demo
namespaces its classes with a short prefix (`fr-` fourier, `ts-` tiled-svd, …) to
avoid clashes.

**Segmented buttons** — a rounded group where the selected one gets the accent fill
(fourier signal picker, drum shape, molecule list):

```html
<span class="seg" id="pick">
  <button data-v="a" class="on">Square</button><button data-v="b">Chirp</button><button data-v="c">Noisy</button>
</span>
```
```css
.seg { display:inline-flex; border:1px solid color-mix(in srgb, var(--eigendeck-fg,#333) 26%, transparent); border-radius:6px; overflow:hidden; }
.seg button { border:0; background:transparent; color:var(--eigendeck-fg,#222); font:inherit; cursor:pointer; padding:.3em .7em; }
.seg button.on { background:var(--eigendeck-accent,#2563eb); color:#fff; }
```

**Labelled slider** — a muted label, a themed native range, and an accent
tabular-nums value (SGD `step`, fourier `keep`, tiled-svd `storage`):

```html
<span class="row"><span>keep</span>
  <input type="range" min="1" max="48" value="6" id="k">
  <span class="val" id="kv">6</span></span>
```
```css
.row { display:flex; align-items:center; gap:.55em; font-size:.62em; color:var(--eigendeck-muted,#888); }
input[type=range] { accent-color:var(--eigendeck-accent,#2563eb);
  background: color-mix(in srgb, var(--eigendeck-fg,#333) 20%, transparent); border-radius:4px; height:.35em; }
.val { color:var(--eigendeck-accent,#2563eb); font-weight:700; font-variant-numeric:tabular-nums; }
```

**Plain button** (`reset`, `clear`, `new sequence`) — a faint fg-tint fill, accent
hover; keep it ~0.8–1em of the base size, readable from the back of a room:

```css
.btn { border:1px solid color-mix(in srgb,var(--eigendeck-fg,#333) 22%,transparent);
  background: color-mix(in srgb,var(--eigendeck-fg,#333) 6%,transparent); color:var(--eigendeck-fg,#222);
  font:inherit; border-radius:7px; padding:.35em 1em; cursor:pointer; }
.btn:hover { background: color-mix(in srgb,var(--eigendeck-accent,#2563eb) 14%,transparent); }
```

Other showcase idioms worth borrowing: a **readout** (`mode 3 · λ = 0.08` — muted
label + accent value), a **clickable list** (rows with hover bg + accent fill when
selected — molecule viewer), a **thumbnail strip** (tiny `<canvas>` previews with
an accent border on the selected — drum mode picker), and a **fading hint**
(`drag to rotate` — muted text, `transition:opacity .4s`, add a `.gone{opacity:0}`
class on first interaction). For a one-off compute, show a translucent "solving…"
overlay and kick the work in `setTimeout(fn, 30)` so the overlay paints first (JS
is single-threaded, and Tauri blocks blob Web Workers — so no worker). See
`example-demos/showcase/README.md` for the full kit and which demo uses each.

### Step-by-Step Algorithm
- Controller: maintain algorithm state (current step, data structures)
- Visualization viewport: render current state
- Controls viewport: step forward/backward buttons
- Code viewport: highlight current line

### Side-by-side comparison demos (design notes — FFT, Chebyshev)

The `fourier` (FFT keep-K) and `polynomial-interpolation` (Chebyshev vs uniform,
Runge) showcase demos share a UI recipe that reads really well on a slide. Reuse it
whenever the *point* is "method A vs method B" or "input vs reconstruction":

- **Two panels, ONE control.** Put the two regimes side by side (uniform | Chebyshev
  nodes; time | frequency) and drive *both* from a single slider. The lesson is the
  contrast, so make the contrast a single gesture — drag once, both panels respond.
- **The labelled slider is the verb.** muted label + native range (`accent-color`) +
  an accent **tabular-nums** value (`degree 12`, `keep 6`). Nothing else competes for
  "what do I touch." (Same slider used for tiled-SVD's `storage`, alignment's `gap`.)
- **Reference faint, result bold.** Draw ground truth (the true function / original
  signal) in `--eigendeck-muted` at low alpha; draw the computed result (interpolant /
  reconstruction) in `--eigendeck-accent`, thicker. The eye reads "result vs truth"
  with no legend.
- **Per-panel readout with SEMANTIC color.** Each panel shows its own metric
  (`max error`, `% error`, `rank · numbers`) and **colors the value by quality** —
  `--eigendeck-accent` when good, a warm red (`#e0483b`) when it's blown up. The
  Chebyshev panel stays blue while the uniform panel turns red: the verdict is in the
  color, not in prose. Always `tabular-nums` so it doesn't jitter while dragging.
- **Clip to the plot frame; fix a shared y-range.** Render inside a clipped rect with
  the SAME y-range on both panels (fair comparison). When a curve diverges it shoots
  off the frame edge — dramatic — instead of auto-rescaling and visually flattening
  the well-behaved panel. (Runge: uniform rockets off-frame; Chebyshev sits still.)
- **Show the CAUSE, not just the effect.** Chebyshev: draw node ticks on the axis so
  the end-clustering that explains the convergence is visible. FFT: the spectrum bars
  (kept = accent, dropped = faded) show *which* coefficients survived. Surface the
  structural reason on the same slide as the outcome.
- **Segmented presets to swap the scenario** without leaving the comparison (signal
  type; function = Runge / steep / |x|). Selected = accent fill (see the control kit
  in `example-demos/showcase/README.md`).
- **Static, recompute on input.** No animation loop — recompute on input. Theme
  vars are correct at mount (and a theme switch re-mounts the demo), so read them
  at init / in your draw; a theme-watcher `setInterval` is no longer needed to
  track live changes.

## Debugging

- The bridge forwards a demo's `console.error`/`console.warn` and uncaught errors
  to Eigendeck's built-in debug console (Cmd+Shift+D) — that's the **primary**
  channel for an opaque-origin demo, since the iframe is its own origin.
- Open WebKit devtools (Cmd+Option+I) to see iframe console output directly.
- Add `console.log('[piece-name]', ...)` in your demo for tracing.
- Check that `BroadcastChannel` messages are flowing between controller and viewports.

## Testing

Export and test your demo in a standalone HTML file:
```bash
node tools/export-eigendeck.mjs project.eigendeck test.html
open test.html
```
