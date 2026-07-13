# Multi-piece demos — controller + pieces over BroadcastChannel

A multi-piece demo splits into independently positioned **pieces** (each a visible
iframe) plus a hidden **controller** iframe that owns state and runs the
simulation. All of them are the **same `.html` file**, branching on the URL hash.
Communication is `BroadcastChannel` — which the injected bridge turns into a
per-instance **relay through the parent** (DEMO_SPEC.md; DEMO-PLATFORM.md §6). Use
this when you want, say, a graph next to a stats panel next to a controls strip,
all driven by one shared state. For a single view, the single-file starter in
`SKILL.md` is simpler — start there.

## The four roles (selected by URL hash)

One file serves all of these; the bridge supplies the hash in every context
(DEMO_AUTHORING.md → "Architecture"; DEMO_SPEC.md → "URL Hash Contract"):

| Hash | Role |
|---|---|
| `#role=controller` | Hidden 0×0 iframe. Runs logic/simulation, owns state, broadcasts it. |
| `#piece=<name>` | A visible viewport. Renders one part, forwards interactions. |
| (no hash) | Standalone dev preview — Eigendeck never loads this; it's for you to open the bare file in a browser. |

**Piece names** may contain letters, digits, `_`, and `-` (e.g. `graph`,
`force-graph`, `bar-chart-2`) — match the exact string in your `piece === '...'`
checks (DEMO_SPEC.md → "Data Model").

## How pieces become slide elements (auto-detection)

You usually don't hand-write the elements. When the demo file is added to a slide,
Eigendeck **scans the HTML for your `piece === '...'` / `piece == "..."` checks and
auto-creates one `demo-piece` element per unique piece name** (as long as the file
also references `BroadcastChannel`), laid out side by side. It also creates one
hidden controller iframe per unique demo on the slide. So you just write the
branches and the pieces appear (DEMO_SPEC.md → "Auto-detection"). You *can* still
author the elements by hand:

```json
[
  { "type": "demo-piece", "demoSrc": "demos/my-demo.html", "piece": "graph",
    "position": { "x": 80,  "y": 200, "width": 900, "height": 650 } },
  { "type": "demo-piece", "demoSrc": "demos/my-demo.html", "piece": "stats",
    "position": { "x": 1010, "y": 200, "width": 780, "height": 650 } }
]
```

## The message protocol (from DEMO_SPEC.md / DEMO_AUTHORING.md)

- **Controller → viewports:** `{ type: 'state', …stateFields }` broadcast on every
  change. Include everything a viewport needs to render.
- **Viewport → controller:** `{ type: 'request-state' }` on load, and interaction
  messages you define, e.g. `{ type: 'click-node', nodeId: 3 }`,
  `{ type: 'drag-node', nodeId: 3, x: 150, y: 200, phase: 'start'|'drag'|'end' }`.
- **Only the controller owns and broadcasts state.** Viewports render and forward;
  they never broadcast state.

Relay constraints you must respect (DEMO_SPEC.md → "BroadcastChannel";
DEMO-PLATFORM.md §6):

- **Structured-clone only** — plain data (objects, arrays, typed arrays). No
  functions, DOM nodes, or class instances.
- **"Everyone-but-me"** — a sender never receives its own message (native
  BroadcastChannel semantics), and it only reaches frames of the *same* demo
  instance.
- **Don't stream at ~60fps across the relay** — it's two hops (piece → parent →
  sibling). Broadcast *state changes*; run `requestAnimationFrame` **locally** in
  each viewport for smooth animation. Push bulk/binary data once, not per frame.
- **A late viewport is fine** — the relay replays the last `state` message to a
  piece that mounts later, so `request-state` on load is belt-and-suspenders.

## Skeleton (one file, all roles)

Factor the simulation (`generateState`) and each piece's `renderFromState` as named
functions so all branches — controller, pieces, standalone — share them.

```html
<!DOCTYPE html>
<!--eigendeck-demo-v1-->
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  /* no background → slide shows through; prefix classes to avoid clashes */
  .mydemo-graph, .mydemo-stats {
    width: 100%; height: 100%;
    font-size: var(--eigendeck-base-size, 20px);
    font-family: var(--eigendeck-font, 'PT Sans'), system-ui, sans-serif;
    color: var(--eigendeck-fg, #222);
  }
</style>
<script>
(function () {
  const params = new URLSearchParams(location.hash.slice(1));
  const role   = params.get('role');
  const piece  = params.get('piece');
  // Hardcode the filename for the channel — don't use location.pathname (empty in the sandbox)
  const channel = new BroadcastChannel('eigendeck-demo:my-demo.html');

  // ---- shared logic (used by every branch) ----
  function generateState() { return { nodes: [/* … */], selected: [] }; }
  function renderGraph(container, state) { /* draw the graph from state */ }
  function renderStats(container, state) { /* draw stats from state */ }

  // ---- controller: hidden, owns state, broadcasts ----
  if (role === 'controller') {
    let state = generateState();
    const broadcast = () => channel.postMessage({ type: 'state', ...state });
    channel.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'request-state') broadcast();
      else if (m.type === 'click-node') { /* mutate state */ broadcast(); }
    };
    setTimeout(broadcast, 50);
    // hide the 0×0 controller body
    const hide = () => { document.body.style.display = 'none'; };
    if (document.body) hide();
    else document.addEventListener('DOMContentLoaded', hide);
    return;
  }

  // ---- viewport: graph ----
  if (piece === 'graph') {
    const mount = () => {
      const c = document.createElement('div');
      c.className = 'mydemo-graph';
      document.body.appendChild(c);
      c.addEventListener('click', () => channel.postMessage({ type: 'click-node', nodeId: 0 }));
      channel.onmessage = (e) => { if (e.data.type === 'state') renderGraph(c, e.data); };
      channel.postMessage({ type: 'request-state' });   // controller may have already broadcast
    };
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', mount) : mount();
    return;
  }

  // ---- viewport: stats ----
  if (piece === 'stats') {
    const mount = () => {
      const c = document.createElement('div');
      c.className = 'mydemo-stats';
      document.body.appendChild(c);
      channel.onmessage = (e) => { if (e.data.type === 'state') renderStats(c, e.data); };
      channel.postMessage({ type: 'request-state' });
    };
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', mount) : mount();
    return;
  }

  // ---- standalone (no hash): Eigendeck never loads this; it's YOUR dev preview.
  //      Make it real — wire the same generator + renderer in-process (no channel) —
  //      so double-clicking the bare .html actually shows the demo, not a blank page.
  document.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.className = 'mydemo-graph';
    document.body.appendChild(c);
    renderGraph(c, generateState());
  });
})();
</script>
</head>
<body></body>
</html>
```

## Checklist (DEMO_AUTHORING.md → "Critical Rules")

- `html, body { width:100%; height:100% }` — else iframe content collapses to zero
  height.
- Guard on `document.readyState` before adding a `DOMContentLoaded` listener.
- **Hide the controller body** — it's a 0×0 iframe but still runs.
- Viewports **request state on load** — the controller may have broadcast first.
- **Prefix all CSS** with a unique name to avoid clashing with other demos / the app.
- **Wrap everything in an IIFE.**
- Hardcode the channel name (the filename); don't use `location.pathname`.
- Only the controller broadcasts state; viewports listen and forward.
- Theme + sizing rules from `SKILL.md` apply to every piece (no background, track
  `--eigendeck-*`, size in `em`, `await document.fonts.ready` before canvas text).
