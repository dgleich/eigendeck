# Eigendeck — Demo Pieces Design

## Problem

Current demos are monolithic iframes. You can't:
- Position parts of a demo independently on a slide
- Reveal pieces of a demo across build slides
- Mix demo elements with text/arrows at different z-levels
- Resize individual parts of a demo

## Concept

A demo exports named **pieces** — each piece becomes a regular slide element that the demo's JavaScript draws into. Eigendeck handles positioning, z-order, and visibility. The demo handles rendering and interaction.

No iframes. Demo JS runs directly in the slide DOM.

## Demo Contract

A demo HTML file defines `window.eigendeckDemo`:

```html
<!-- demos/bfs-demo.html -->
<style>
  /* Scoped styles for demo pieces */
  .bfs-graph { background: #f8f8f8; }
  .bfs-controls button { padding: 8px 16px; font-size: 18px; }
</style>
<script>
  window.eigendeckDemo = {
    // Declare pieces with default sizes
    pieces: {
      graph:    { width: 800, height: 600, label: 'BFS Graph' },
      controls: { width: 400, height: 80,  label: 'Controls' },
      output:   { width: 600, height: 200, label: 'Step Output' },
    },

    // Called once when the demo is loaded
    // containers: { graph: HTMLElement, controls: HTMLElement, output: HTMLElement }
    init(containers) {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      containers.graph.appendChild(canvas);
      containers.graph.classList.add('bfs-graph');

      const btn = document.createElement('button');
      btn.textContent = 'Step';
      btn.onclick = () => step();
      containers.controls.appendChild(btn);
      containers.controls.classList.add('bfs-controls');

      // Demo logic...
      function step() { /* ... */ }
    },

    // Optional: called when a piece is resized
    resize(piece, width, height) {
      if (piece === 'graph') {
        // Resize canvas, redraw, etc.
      }
    },

    // Optional: called with state from demoState field (for linked slides)
    setState(state) {
      // e.g. { step: 3, highlighted: [1, 4, 5] }
    },

    // Optional: cleanup
    destroy() {
      // Cancel animation frames, remove listeners, etc.
    }
  };
</script>
```

## Data Model

### Adding a Demo

When a demo file with `eigendeckDemo` is added to a slide:

1. Eigendeck loads and executes the demo's `<script>` tags
2. Reads `window.eigendeckDemo.pieces` to discover available pieces
3. Creates one `demo-piece` element per piece on the current slide
4. Calls `init(containers)` with the DOM elements

### Element Type

New element type `demo-piece`:

```json
{
  "id": "uuid",
  "type": "demo-piece",
  "demoSrc": "demos/bfs-demo.html",
  "piece": "graph",
  "position": { "x": 80, "y": 200, "width": 800, "height": 600 },
  "demoState": { "step": 0 }
}
```

- `demoSrc`: path to the demo HTML file (shared by all pieces from the same demo)
- `piece`: which piece this element represents
- `demoState`: optional state passed to `setState()` — can differ per slide for builds

### Demo Instance Management

Multiple elements can reference the same `demoSrc`. The demo's JS is loaded once per unique `demoSrc` on a slide. The `init()` function receives containers for all pieces present on that slide.

If a slide only has 2 of 3 pieces, `init()` only gets those 2 containers. This naturally supports progressive reveal across build slides.

## Rendering

### Editor

Each `demo-piece` element renders as a `DraggableBox` containing a plain `<div>`. The demo's JS draws into these divs. All standard interactions work:
- Drag to reposition
- Resize handle (calls `resize()` callback)
- Delete button
- Z-order controls
- Selection, multi-select, copy/paste

### Presenter

Same rendering — demo pieces are positioned absolutely on the slide canvas. The demo JS runs and draws into the containers.

### Export

For HTML export, the demo's script and styles are inlined. Each piece becomes a positioned div. The demo's `init()` runs on page load.

## Lifecycle

### Loading

1. Parse demo HTML: extract `<script>` and `<style>` tags
2. Inject styles into a scoped container (or use Shadow DOM)
3. Execute scripts to populate `window.eigendeckDemo`
4. Read piece definitions
5. Create DOM containers for each piece element on the slide
6. Call `init(containers)`

### Slide Navigation (Editor)

When switching slides in the editor:
- If the new slide has pieces from the same demo, reuse the demo instance
- Call `setState(demoState)` if the piece has a `demoState` field
- Pieces not present on the new slide: hide their containers
- Pieces newly present: show and potentially call `init()` for new containers

### Slide Navigation (Presenter)

During presentation, advancing slides:
- Linked demo-piece elements animate position/size (existing linked objects system)
- New pieces fade in, removed pieces fade out
- `setState()` called on each transition for state changes
- This enables animated build-up of a demo across slides

### Cleanup

When a demo is fully removed from a presentation (no slides reference it):
- Call `destroy()` if defined
- Remove injected scripts and styles

## Style Isolation

Demo styles could leak into the app UI. Options:

1. **Naming convention**: Demo authors prefix all CSS (e.g. `.bfs-graph`)
2. **Shadow DOM**: Each piece container is a shadow root — full isolation
3. **Scoped `<style>`**: Inject demo styles inside each container

Recommendation: Start with naming convention (simplest). Add Shadow DOM later if needed. Since demos are authored by the same person using them, leakage is self-inflicted and easy to fix.

## Interaction with Existing Features

### Linked Objects
Demo pieces get `linkId`/`syncId` like any element. Position syncs and animation transitions work out of the box.

### Copy/Paste
Copying a demo-piece copies the element data. The demo JS is shared by reference (`demoSrc`), not duplicated.

### Build Slides
Duplicating a slide duplicates all demo-piece elements. Add pieces on later slides for progressive reveal. Remove pieces for progressive hide. Change `demoState` per slide for state-based builds.

### Undo/Redo
Position and state changes are tracked by the existing undo system.

## Migration from Current Demos

The existing `demo` element type (iframe-based) continues to work unchanged. `demo-piece` is a new element type. Demo authors can choose which format to use.

A demo HTML file can support both: if it has `window.eigendeckDemo`, use pieces; otherwise, fall back to iframe.

## Open Questions

1. **How to scope demo JS?** Running demo scripts in the app context risks naming collisions. Options: unique namespace per demo, or run in a module scope via dynamic `import()`.

2. **Canvas vs DOM?** Should piece containers be `<canvas>` elements (demo gets a 2D/WebGL context) or `<div>` elements (demo appends arbitrary DOM)? Recommendation: `<div>` — more flexible, demo can create its own canvases if needed.

3. **Resize behavior**: When the user resizes a piece element, should the content scale (CSS transform) or reflow (call `resize()` with new dimensions)? Probably `resize()` callback for canvases, CSS scale for DOM content. Could be configurable per piece.

4. **Multiple instances**: If the same demo is used on unrelated slides (not build slides), should they share state or be independent instances? Probably independent.

5. **Hot reload**: When the demo HTML file changes on disk, should Eigendeck reload it? The current iframe demo has a reload button — same approach works.

6. **Security**: No sandboxing. Demo JS can access the app's DOM, store, etc. Acceptable for self-authored demos. Could add opt-in iframe fallback for untrusted demos.

## Implementation Order

1. Add `demo-piece` element type to the data model
2. Demo loader: parse HTML, extract scripts/styles, execute, read piece definitions
3. Renderer: create containers, call `init()`, handle resize
4. Editor integration: "Add Demo" detects `eigendeckDemo` and creates piece elements
5. Presenter support: render pieces, call `setState()` on transitions
6. Export: inline demo scripts/styles in exported HTML
