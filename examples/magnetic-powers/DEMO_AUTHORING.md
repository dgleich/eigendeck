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

  // Channel name: use the filename for uniqueness
  const channelName = 'eigendeck-demo:' + location.pathname.split('/').pop();
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

7. **Channel name must match** — Use the same formula in all roles:
   ```js
   const channelName = 'eigendeck-demo:' + location.pathname.split('/').pop();
   ```

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
