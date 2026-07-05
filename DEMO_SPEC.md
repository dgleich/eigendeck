# Eigendeck Demo Pieces — Author Spec

## Overview

An Eigendeck demo can be split into **pieces** — independently positionable regions on the slide. Each piece is an iframe showing a specific part of the demo. A hidden **controller** iframe manages shared state.

All communication happens via `BroadcastChannel`. The demo HTML file serves all roles based on URL hash parameters.

Demos run in an **opaque-origin sandbox** (`sandbox="allow-scripts"`, no
`allow-same-origin`): no access to the app, Tauri, `window.top`/`window.parent`,
and no `localStorage`/`sessionStorage`/`cookies`/`IndexedDB`. The
`BroadcastChannel` you use is **not** a native same-origin channel — an
app-injected bridge **relays** it through the parent, keyed per demo instance.
Fetching from the internet / a CDN still works.

### Required marker

Every demo file **must** begin with the marker `<!--eigendeck-demo-v1-->`, placed
**immediately after** `<!DOCTYPE html>`. It's the mount gate — an unmarked file is
not shown as a demo:

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html> …
```

## Architecture

```
Controller iframe (hidden, persistent)
  ├── Runs simulation/logic, owns state
  ├── Broadcasts state to all viewports
  └── Listens for interaction events from viewports

Viewport: graph (#piece=graph)
  ├── Renders graph visualization
  ├── Forwards clicks/drags to controller
  └── Updates display from controller state

Viewport: stats (#piece=stats)
  ├── Renders statistics
  └── Updates display from controller state
```

## URL Hash Contract

Your demo HTML is loaded with different hash parameters depending on its role:

| Hash | Role | Description |
|------|------|-------------|
| `#role=controller` | Controller | Hidden, runs logic, broadcasts state |
| `#piece=graph` | Viewport | Visible, renders the "graph" piece |
| `#piece=stats` | Viewport | Visible, renders the "stats" piece |
| (none) | Standalone | Legacy fallback, renders everything |

Parse the hash at the top of your script:

```js
const params = new URLSearchParams(location.hash.slice(1));
const role = params.get('role');   // 'controller' or null
const piece = params.get('piece'); // piece name or null
```

> **Bridge (all contexts):** In every context — editor, presenter, and HTML export — demos run inside sandboxed iframes where `location.hash` and `location.pathname` are empty. Eigendeck injects a bridge script that patches `URLSearchParams` and `location.hash` and `BroadcastChannel` so the above patterns work everywhere. No special handling needed in your demo code.

## BroadcastChannel

All iframes from the same demo communicate via `BroadcastChannel`:

```js
// Hardcode your demo's filename — don't use location.pathname (empty in srcdoc)
const channelName = 'eigendeck-demo:mydemo.html';
const channel = new BroadcastChannel(channelName);
```

> **Note:** In **all** contexts (editor, presenter, export) the injected bridge
> overrides the `BroadcastChannel` constructor, keyed per demo instance. It is
> **not** a native same-origin channel: it's a **star relay through the parent**
> ("everyone-but-me" — a sender never receives its own message), which also keeps
> demos on different slides from colliding.
>
> - **Payloads are structured-clone only** — plain data (objects, arrays,
>   typed arrays). No functions, DOM nodes, or class instances.
> - **Don't stream at ~60fps** across the relay. Broadcast *state changes*, and
>   run `requestAnimationFrame` locally in each viewport.

### Controller Messages (outgoing)

The controller broadcasts state to all viewports:

```js
channel.postMessage({
  type: 'state',
  // Include everything viewports need to render
  nodePositions: { 0: { x: 100, y: 200 }, ... },
  selectedNodes: [2, 4],
  // ... any other state
});
```

### Viewport Messages (outgoing)

Viewports forward user interactions to the controller:

```js
// Node click
channel.postMessage({ type: 'click-node', nodeId: 3 });

// Node drag
channel.postMessage({ type: 'drag-node', nodeId: 3, x: 150, y: 200, phase: 'start' });
channel.postMessage({ type: 'drag-node', nodeId: 3, x: 160, y: 210, phase: 'drag' });
channel.postMessage({ type: 'drag-node', nodeId: 3, x: 170, y: 220, phase: 'end' });

// Clear selection
channel.postMessage({ type: 'clear-selection' });

// Request current state (on initial load)
channel.postMessage({ type: 'request-state' });
```

### Viewport Messages (incoming)

Viewports listen for state updates and re-render:

```js
channel.onmessage = (e) => {
  if (e.data.type === 'state') {
    renderFromState(e.data);
  }
};
```

## Demo HTML Structure

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html>
<head>
<style>
  /* Prefix styles to avoid conflicts */
  .my-demo-graph { ... }
  .my-demo-stats { ... }
</style>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
  const params = new URLSearchParams(location.hash.slice(1));
  const role = params.get('role');
  const piece = params.get('piece');
  const channel = new BroadcastChannel('eigendeck-demo:my-demo.html');

  if (role === 'controller') {
    // Run simulation, manage state, broadcast updates
    // Hide body: document.body.style.display = 'none';
    return;
  }

  if (piece === 'graph') {
    // Render graph, forward interactions to controller
    return;
  }

  if (piece === 'stats') {
    // Render stats from controller state
    return;
  }

  // Standalone fallback
})();
</script>
</head>
<body></body>
</html>
```

## Data Model

### Element Type

```json
{
  "id": "uuid",
  "type": "demo-piece",
  "demoSrc": "demos/graph-explorer.html",
  "piece": "graph",
  "position": { "x": 80, "y": 200, "width": 900, "height": 650 }
}
```

- `demoSrc`: path to the demo HTML file
- `piece`: name passed as `#piece=NAME` to the iframe. **Names may contain
  letters, digits, `_`, and `-`** (e.g. `force-graph`, `bar-chart-2`) — match the
  exact string in your `piece === '...'` checks.

### Auto-detection (when you add a demo)

You usually don't hand-write the `demo-piece` elements. When a demo HTML file is
**added to a slide** (drag-drop, file import, or paste), Eigendeck scans it for
`piece === '...'` / `piece == "..."` checks and **auto-creates one `demo-piece`
element per unique piece name** it finds (laid out side by side), as long as the
file also references `BroadcastChannel`. So just write the `if (piece === '...')`
branches and the pieces appear — including hyphenated names like `'force-graph'`.
(You can still author/edit the elements by hand via the JSON above.)

### Controller Iframe

Eigendeck automatically creates a hidden controller iframe (`#role=controller`) for each unique `demoSrc` on the current slide. The controller persists as long as any piece from that demo is visible.

## Interaction in Editor

Demo pieces use the same overlay pattern as regular demos:
- **Locked** (default): overlay captures pointer events for drag/resize
- **Play/double-click**: overlay removed, pointer events pass to iframe
- **Lock button**: returns to drag mode

## Piece Visibility Across Slides

Show different pieces on different slides for progressive reveal:

- Slide 1: only `graph` piece
- Slide 2: `graph` + `stats` pieces
- Slide 3: `graph` + `stats` + `controls` pieces

The controller iframe runs as long as any piece from the demo is on the current slide.

## Tips

1. **Request state on load**: Viewports should `postMessage({ type: 'request-state' })` immediately — the controller may have already broadcast before the viewport loaded.

2. **Prefix CSS**: Use a unique prefix for all CSS selectors (e.g., `.ge-graph`) to avoid conflicts with the Eigendeck UI.

3. **CDN scripts**: External scripts (D3, etc.) are fetched independently by **each** iframe — every opaque-origin iframe is its own origin with no shared cache, so there's no cross-iframe reuse. Keep CDN payloads modest.

4. **Keep viewports lightweight**: Heavy computation belongs in the controller. Viewports should only render.

5. **Standalone fallback**: Support loading without hash params so the demo works when opened directly in a browser.

## Example

See `examples/graph-explorer/demos/graph-explorer.html` for a complete demo with:
- Controller: D3 force simulation, path counting via matrix power
- Graph viewport: force-directed layout with clickable/draggable nodes
- Stats viewport: node degree, neighbors, directed path counts
