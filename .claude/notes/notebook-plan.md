# Plan: Live Jupyter notebook in a slide

Author note: This plan is for the next agent picking up this task with
fresh context. Repo state at planning time: `main` at the commit
that pushed this plan (Eigendeck v2026.5.31). Read `/work/docs/ASSETS.md`
and `/work/SQLITE_STORAGE.md` first — they document the asset model
and schema this feature plugs into.

## Goal

Embed a **live, executing** Jupyter notebook as a first-class element
type on a slide. The presenter (a CS professor giving a talk on
matrix / graph algorithms / HPC) wants to:

- Show code on screen during the talk
- Run a cell live (Shift-Enter equivalent) and have the output appear
- Modify a parameter (`k = 5` → `k = 10`) and re-run to demonstrate
  algorithmic behavior
- Have it composed with the rest of the slide (title, surrounding
  text, possibly images / arrows pointing at parts of the output)

**Static notebook rendering (just displaying the saved cells +
outputs) is explicitly NOT the goal.** That's essentially a PDF
screenshot — it'd work but it'd offer nothing over the existing
PDF-embed path. The whole point is live computation visible to the
audience.

## Non-goals (v1)

- **Multi-user collaboration** in the notebook
- **Kernel persistence across project saves** — kernel restarts on
  deck reopen is acceptable
- **Authoring notebooks inside Eigendeck.** The presenter authors in
  JupyterLab/VSCode/wherever they normally do; eigendeck embeds the
  result.
- **Live exec for non-Python kernels** (R, Julia, etc.) — v1 is
  Python via Pyodide. Other kernels are a v2 conversation.

## Recommended architecture: JupyterLite (Pyodide in-browser)

Embed a [JupyterLite](https://jupyterlite.readthedocs.io/) distribution
inside the app. Each notebook element is an `<iframe>` pointing at the
embedded JupyterLite's `lab/index.html?path=...`, loaded with the
user's `.ipynb` from eigendeck's asset table.

Kernel = Pyodide (Python compiled to WASM). Runs entirely in the
WebView. No external process, no Python install required, no
network calls during a talk.

### Why JupyterLite over alternatives

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **JupyterLite (Pyodide WASM)** | Self-contained; deck works for anyone who opens it; no Python install; no network during talk | ~30MB bundle; 3-5s first-cell startup; some C-extension packages unavailable | **CHOSEN** |
| Subprocess kernel via Tauri | Full CPython, all packages, fast | Process lifecycle complexity; user must have Python + the right packages; OS-specific subprocess code; "kernel died during talk" failure mode | v2 if Pyodide hits a wall |
| Connect to user's running Jupyter server | Easiest implementation | User has to remember to start the server; "demo on someone else's laptop" workflows broken | NO |
| Bundle a CPython interpreter (PyInstaller-style) | Full Python | Massive bundle (~100MB); cross-platform packaging hell; user-env package mismatch | NO |

The "self-contained, deck works for anyone" property is huge for the
presenter use case. You hand someone the `.eigendeck` file (or open
the same one on a different laptop), it Just Works. No "did you
install scipy? what version of numpy?"

### What works / doesn't work in Pyodide

**Works**: numpy, scipy, pandas, matplotlib, networkx, sympy, scikit-learn,
sympy, plotly, ipywidgets (partial), Python stdlib. Roughly the
PyData stack minus things needing native C extensions not yet ported.

**Doesn't work** (or is awkward): PyTorch (partial), TensorFlow,
anything spawning subprocesses, anything reading arbitrary files
outside the virtual FS, anything needing a real OS thread pool.

For David's matrix/graph/HPC content: numpy + scipy + networkx +
matplotlib cover essentially everything. The few HPC libraries
that don't (e.g. MPI bindings) are dealbreakers — but for those
cases, the presenter likely has a recorded video anyway.

## Data model

### New element type: `notebook`

Add to `src/types/presentation.ts`:

```ts
export interface NotebookElement extends BaseElement {
  type: 'notebook';
  /** Stable asset_id binding — see ImageElement.assetId. */
  assetId: string;
  /** Optional: cells to show in the iframe. Default: all cells. */
  visibleCells?: number[];
  /** Optional: starting kernel state — JSON of preamble code that
   *  runs before any cell. Useful for "set up these imports + helper
   *  fns up front so the cells stay short." */
  preamble?: string;
  /** Optional: auto-run on slide enter. When true, all visible
   *  cells execute as soon as the slide becomes active in
   *  PresentMode. Default false (presenter triggers manually). */
  autoRun?: boolean;
}
```

### Asset storage

The `.ipynb` JSON is stored in `assets.data` (mime
`application/x-ipynb+json`) with `external_path` set for the
file-watcher to track edits. Same asset machinery the existing
types use. No `asset_cache` — there's nothing to rasterize.

### `detectAssetKind` extension

Add `'notebook'` to the `AssetKind` union in `src/lib/assetCache.ts`
and the function returns `'notebook'` for mime `application/x-ipynb+json`
or `.ipynb` extension.

## JupyterLite bundle strategy

### What to bundle

JupyterLite ships as a `npm install @jupyterlite/lab` (or a CLI-built
static dist via `jupyter lite build`). Two options:

1. **Build a custom JupyterLite dist at eigendeck build time**, drop
   into `public/jupyterlite/`. CLI: `jupyter lite build --piplite-wheels=...`
   for custom package bundles. Output is a static directory the
   WebView can load.
2. **Use the published @jupyterlite/lab npm package** and serve its
   built artifacts. Less control over the package set; faster to
   wire up.

Recommend option **1** for v1: one-time setup cost buys us control
over which packages are pre-loaded into the Pyodide environment
(numpy + scipy + matplotlib + networkx, which are 80% of the slide
demos).

### Where it lives in the repo

- `public/jupyterlite/` — the built JupyterLite distribution
  (gitignored; built by a `npm run setup-jupyterlite` step similar
  to how `public/mathjax/` is populated)
- `jupyterlite-bundle/` — config + build script for the custom
  dist (parallel to `mathjax-ptsans-bundle/`)
- `scripts/setup-jupyterlite.mjs` — runs the bundle build

### Bundle size budget

Estimated:
- JupyterLite core: ~5 MB
- Pyodide runtime: ~10 MB
- numpy + scipy + matplotlib pre-bundled wheels: ~15 MB
- Total: **~30 MB**

This is the biggest single addition to the app's bundle since pdfium.
Lazy-loaded: only fetched when the first notebook element renders
(via dynamic import / iframe lazy src). Doesn't affect cold app start
for decks without notebooks.

## Loading a user's notebook into JupyterLite

JupyterLite has a "virtual filesystem" backed by browser storage
(IndexedDB). To get our `.ipynb` into it:

- Custom JupyterLite contents provider that reads/writes via Tauri
  IPC instead of IndexedDB. The provider calls back to eigendeck
  (e.g., via `postMessage` from iframe → parent → invoke
  `db_get_asset_by_id` / `db_store_asset`).
- On notebook-element mount: pass the `assetId` via iframe URL
  param. Iframe boots JupyterLite, provider hooks into asset_id,
  fetches bytes, populates the file via custom provider.
- On notebook save (user does Ctrl-S inside the iframe): provider
  intercepts, posts back to parent, parent calls
  `storeAssetWithCollisionCheck` to update the asset (new version
  in the temporal store).

This is **non-trivial**. The plumbing is iframe-postMessage-Tauri
glue. Get it working for a fresh-load case first; save-from-iframe
can be a later phase.

## Slide canvas integration

Mirror the image/demo element pattern in
`src/components/SlideElementRenderer.tsx`:

1. `<NotebookBox>` component, sibling to `<ImageBox>` / `<DemoBox>`.
   Renders an iframe inside a `<DraggableBox>` for position/resize.
2. Iframe src: `/jupyterlite/lab/index.html?asset=<assetId>`.
3. Iframe `sandbox` attribute: allow scripts (kernel runs JS),
   same-origin (provider needs IPC).
4. Postmessage bridge between iframe ↔ parent for file I/O.
5. Same overlay-for-dragging trick the existing demo iframe uses
   (transparent div over the iframe captures pointer events
   while not editing).

## PresentMode

Notebook element in PresentMode renders the SAME iframe — full live
kernel. Presenter clicks into the iframe to interact (Shift-Enter to
run a cell, edit code, etc.).

Kernel state persists as long as the iframe is mounted in the DOM.
Slide nav unmounts → state lost. For v1, accept this — most notebook
demos live on one slide. For v1.5: keep notebook iframes mounted
across all slides (hidden), so navigating away and back preserves
state.

## Sidebar tile

`<SidebarNotebookTile>` placeholder div (no live iframe in the
sidebar — too expensive). Just a labeled "NOTEBOOK" tile that calls
`useAssetFileWatcher(element.assetId, element.id)` so the watcher
subscribes for source-file change auto-reload.

## Insertion paths

### Drag-drop from Finder

In `SlideEditor.tsx`'s `onDragDropEvent` handler, add `.ipynb` →
notebook branch. Same shape as the demo branch, just different
mime + element type.

### `+ Notebook` button in toolbar

App.tsx adds a `+ Notebook` button that file-picks `.ipynb` and
calls the same insertion path. Default element size: large (most of
the slide) since notebooks need vertical space for cells + outputs.

## Implementation phases

Each phase = one reviewable commit boundary that leaves the branch
in a working state.

1. **JupyterLite dist setup**
   - Add `jupyterlite-bundle/` with the config + build script
   - Add `scripts/setup-jupyterlite.mjs` to build + copy
   - Verify `public/jupyterlite/lab/index.html` loads in a browser
   - Document in CLAUDE.md the `npm run setup-jupyterlite` step
   - Land as one commit.

2. **Type + asset wiring**
   - Add `NotebookElement` to `src/types/presentation.ts`
   - Extend `detectAssetKind` to recognize `.ipynb` / `application/x-ipynb+json`
   - Schema-compat test stays green
   - Land as one commit.

3. **Iframe-based static notebook display (no kernel yet)**
   - Add `<NotebookBox>` rendering an iframe pointing at JupyterLite
     in **read-only mode** with the user's `.ipynb` loaded
   - The iframe shows the notebook UI but doesn't yet execute
   - Drag a notebook in, see cells displayed
   - Land as one commit.

4. **File-bridge: load notebook bytes into the iframe**
   - Implement the postMessage bridge: iframe asks parent for asset
     bytes by assetId; parent invokes `db_get_asset_by_id` and
     responds
   - Custom JupyterLite contents provider hooks into this
   - Iframe loads the actual cells from the asset
   - Land as one commit.

5. **Kernel execution**
   - Enable Pyodide kernel in the JupyterLite dist
   - Bundle numpy + scipy + matplotlib wheels
   - User can Shift-Enter cells, see outputs in the iframe
   - Land as one commit. **MILESTONE: live exec works.**

6. **Save-from-iframe**
   - Reverse direction of the file bridge: iframe Ctrl-S →
     postMessage to parent → parent calls
     `storeAssetWithCollisionCheck` to update the asset (new version
     in temporal store) → file watcher notices the asset_id change
     and (via the no-byte-change hash check) does NOT invalidate
     the iframe (which would lose kernel state)
   - Land as one commit.

7. **Insertion (drag-drop + + Notebook button)**
   - Add `.ipynb` branch to `SlideEditor.tsx` drop handler
   - Add `+ Notebook` button in App.tsx toolbar
   - Land as one commit.

8. **Inspector — preamble + autoRun controls**
   - Extend AssetSection consumer (or add NotebookOptions section)
   - Wire `preamble` (text area for setup code that runs before
     cells) and `autoRun` (checkbox) through `updateElement`
   - Land as one commit.

9. **PresentMode**
   - Render the same iframe in PresentMode
   - Verify pointer events reach the iframe (no DraggableBox overlay
     in present mode)
   - Land as one commit.

10. **Documentation + mutate-notebook.py**
    - Update `docs/ASSETS.md` Renderer section to mention notebook
      kind + iframe lifecycle
    - Update `LLM-EDITING.md` element-type list
    - Add `gitignore/mutate-notebook.py` (parallel to mutate-svg /
      mutate-pdf / mutate-demo) — bumps a cell's content so
      file-watcher reload can be tested
    - Land as one commit.

## Risks / open questions

- **Bundle size**: ~30 MB. App download grows substantially. Mitigate
  via lazy-load — JupyterLite is only fetched when the first
  notebook element renders.
- **First-cell startup latency**: Pyodide init is ~3-5s. Pre-warm
  by booting the kernel as soon as the slide containing a notebook
  becomes visible (or one slide ahead in present mode).
- **Tauri WebKit + Pyodide compatibility**: Pyodide uses
  WebAssembly + WebWorkers + SharedArrayBuffer. Tauri's WebKit
  might block some of these. Worth a one-day spike to confirm
  Pyodide actually runs in Tauri before committing to the larger
  plan. **Do this before starting Phase 1.**
- **Notebook saves and the file watcher**: when iframe saves a new
  cell, eigendeck writes the asset, file-watcher will fire on
  the external file (if any) — need to make sure the iframe
  doesn't get force-reloaded (kernel state loss). The recently-
  shipped hash-check in `scanForChangedAssets` handles
  iframe-initiated saves correctly (hash will differ → invalidate
  cache → but cache for notebooks isn't really a thing). The
  iframe itself reloading is the real concern; should NOT remount
  the iframe just because asset bytes changed via the iframe's
  own save.
- **Kernel state across slide navigation**: lost when iframe
  unmounts. v1 accepts this. v1.5: keep iframe mounted (hidden)
  across all slides.
- **Subprocess kernel fallback**: if Pyodide can't run something
  the user needs (e.g., PyTorch), the path forward is the
  subprocess-kernel approach (v2). Data model already supports it
  — the element binds an asset_id; the executor backend can be
  swapped.
- **Notebook authoring round-trip**: user edits the `.ipynb` in
  JupyterLab outside eigendeck, saves it, file watcher reloads.
  The iframe needs to handle "your contents changed on disk" gracefully
  — probably show a "reload notebook to see changes" prompt rather
  than auto-reload (would lose kernel state).
- **Plotly / ipywidgets**: ipywidgets support in JupyterLite is
  partial; some interactive widgets work, some don't. Worth
  testing the common cases (sliders, dropdowns) during Phase 5.

## Test plan

- Vitest: `detectAssetKind` returns `'notebook'` for `.ipynb` and
  mime.
- **Spike test (do FIRST, before Phase 1):** load JupyterLite
  inside a Tauri WebView, run `import numpy; numpy.zeros(5)`,
  confirm it works. If not, the whole plan needs rethinking.
- Manual: drag a fixture `.ipynb` onto a slide, see the cells.
- Manual: Shift-Enter a cell, see the output.
- Manual: edit a cell value (e.g. `k=10`), Shift-Enter, see new
  output. Save (Ctrl-S in iframe), verify asset version history
  shows the new version.
- Manual: edit the source `.ipynb` on disk via mutate-notebook.py,
  watch the slide handle the change without losing kernel state
  (prompt to reload or similar).
- Schema-compat: add a fixture `.eigendeck` with a notebook
  element under `examples/`.

## Reference

- JupyterLite docs: https://jupyterlite.readthedocs.io/
- Pyodide: https://pyodide.org/
- JupyterLite contents API: https://jupyterlite.readthedocs.io/en/latest/howto/configure/contents.html
- Existing similar pattern: `mathjax-ptsans-bundle/` (custom build
  artifact lives in repo, copied to `public/` at setup time)

## What lives in `/work/.claude/notes/` already (related context)

- `pdf-plan.md` — the original PDF rendering plan (a similar-scoped
  feature that shipped; good template for phase boundaries)
- `asset-model-refactor-plan.md` — the asset-model phases
- `startup-notes.md` — project cold-start context

When you start: read this file. Then do the Pyodide-in-Tauri spike
test BEFORE any other work. If that fails, come back and re-plan.
