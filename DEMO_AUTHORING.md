# Building Eigendeck Demo Pieces — Guide for LLMs and Tools

This guide explains how to create interactive demos that integrate as positionable pieces in Eigendeck presentations.

## Architecture

A demo is a single HTML file that serves three roles based on URL hash:

```
#role=controller  → Hidden iframe, runs logic/simulation, broadcasts state
#piece=graph      → Visible iframe, renders the "graph" piece
#piece=stats      → Visible iframe, renders the "stats" piece
(no hash)         → Standalone mode, works in a browser directly
```

All communication between controller and viewports uses `BroadcastChannel`.

**Piece names** can be any string of letters, digits, `_`, and `-`
(e.g. `graph`, `force-graph`, `bar-chart-2`). When you add a demo to a slide,
Eigendeck **scans the HTML for your `piece === '...'` checks and auto-creates a
piece element for each unique name** (as long as the file also uses
`BroadcastChannel`) — so you just write the branches and the pieces appear. See
`DEMO_SPEC.md` for the data model.

## Template

```html
<!DOCTYPE html>
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
  // 5. Standalone fallback (no hash)
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<p style="padding:20px">Open in Eigendeck for full demo.</p>';
  });
})();
</script>
</head>
<body></body>
</html>
```

## How Eigendeck Loads Demos

Demos run in three contexts, all handled automatically:

| Context | iframe type | `location.hash` | `BroadcastChannel` |
|---------|------------|------------------|---------------------|
| **Editor** | blob URL | Works natively | Works natively |
| **Presenter** | blob URL | Works natively | Works natively |
| **HTML Export** | srcdoc | Empty (broken) | Pathname empty (broken) |

For HTML export, Eigendeck injects a bootstrap `<script>` before your code that:
1. Patches `URLSearchParams` — if `location.hash` is empty (srcdoc), the constructor injects the correct piece/role params
2. Patches `BroadcastChannel` — adds a unique per-slide prefix so demos on different slides don't collide

**You don't need to handle this.** Just use the standard pattern:
```js
const params = new URLSearchParams(location.hash.slice(1));
const channel = new BroadcastChannel('eigendeck-demo:mydemo.html');
```
Use a hardcoded filename for the channel name. The bootstrap patches `URLSearchParams` and adds a unique per-slide prefix to `BroadcastChannel` automatically.

## Matching the deck — fonts & theme

A demo runs in an isolated iframe over the slide. Two rules make it match the
deck automatically — the most important one is **don't paint a background**.

1. **Don't set a background — let it be transparent.** A demo iframe is
   transparent, so if you DON'T set `background` on `html`/`body` (or your
   full-size container), the **slide's background shows straight through**. That's
   automatic background matching on every theme, with zero CSS and no fallback to
   keep in sync. Only set a background when you specifically need to *cover* slide
   content behind the demo, or to guarantee contrast for a busy visualization.

2. **Fonts resolve automatically.** Eigendeck injects `@font-face` for the deck's
   fonts into every demo (editor, presenter, export), so `font-family: 'PT Sans'`
   (or whatever the slide uses) just works — no change needed. For text drawn
   over the transparent background, set `color: var(--eigendeck-fg, #222)` so it
   stays readable on light AND dark slides.

   ```css
   body {
     /* no background → the slide shows through and matches any theme */
     color: var(--eigendeck-fg, #222);
     font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
   }
   ```

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

The vars update **live** when the slide/deck theme changes (the demo isn't
reloaded), so a demo authored against them tracks dark/light themes for free. You
can also read or change them programmatically for dynamic effects, e.g.

```js
const fg = getComputedStyle(document.documentElement).getPropertyValue('--eigendeck-fg').trim();
// d3 strokes that follow the theme:  .attr('stroke', 'var(--eigendeck-fg)')
// or drive your own:  document.documentElement.style.setProperty('--my-color', fg);
```

See `demo-starter.html` (from **File → Install LLM Tools**) for the pattern.

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

### Step-by-Step Algorithm
- Controller: maintain algorithm state (current step, data structures)
- Visualization viewport: render current state
- Controls viewport: step forward/backward buttons
- Code viewport: highlight current line

## Debugging

- Open WebKit devtools (Cmd+Option+I) to see iframe console output
- Eigendeck's built-in debug console (Cmd+Shift+D) shows app-level logs
- Add `console.log('[piece-name]', ...)` in your demo for tracing
- Check that `BroadcastChannel` messages are flowing between controller and viewports

## Testing

Export and test your demo in a standalone HTML file:
```bash
node tools/export-eigendeck.mjs project.eigendeck test.html
open test.html
```
