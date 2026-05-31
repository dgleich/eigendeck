# Plan: Jupyter notebook in a slide

Author note: This plan is for the next agent picking up this task with
fresh context. The repo state at planning time is `main` at commit
`968eb81` (Eigendeck v2026.5.31). Read `/work/docs/ASSETS.md` and
`/work/SQLITE_STORAGE.md` first — they document the asset model and
schema this feature plugs into.

## Goal

Embed a Jupyter notebook (`.ipynb`) as a first-class element type on a
slide, so a talk that walks through code + outputs (data science,
matrix algorithms, anything Python-heavy) doesn't need separate
windows or screen-share workarounds. The author drops in a notebook,
chooses what to display, and it renders on the slide alongside text,
images, PDFs, and demos.

## Non-goals (v1)

- **Live cell execution** in the slide. v1 is rendering-only. The user
  edits the notebook elsewhere (Jupyter / JupyterLab / VSCode), saves
  it, drops it into the slide. Live exec is a v2 conversation.
- **Cell editing in the slide.** Read-only display.
- **Multiple kernels / dependency management.** None of that in v1.
- **Notebook authoring UX.** Eigendeck is a presentation tool, not a
  notebook editor.

## Recommended approach: render-only, .ipynb-as-asset

Treat `.ipynb` as another asset type, alongside images / PDFs /
demo-HTML. The slide element renders the notebook's cells (markdown +
code + pre-computed outputs) as static HTML. Same asset-management
machinery the existing types use: storage in `assets` table,
external-path watching for in-place edits, version history,
restore-from-history.

This sits at the same architectural layer as the existing `'demo'`
type and benefits from every piece of plumbing already built (file
watcher, scan-on-load, collision dialog, inspector AssetSection).

### Why not live execution

- **JupyterLite (Pyodide)** would work in-browser but adds ~30MB of
  initial download and ~3-5s startup before first cell can run. For
  a presentation tool that's all-but-zero on the audience-experience
  axis and large on the bundle size axis. Pyodide also lacks several
  native-CPython packages (anything with C extensions that hasn't
  been ported).
- **Local Jupyter server** (user runs `jupyter server`, slide talks
  WebSocket) shifts kernel-management complexity onto the presenter
  during a high-stress moment (talk).
- **Embedded kernel via Tauri subprocess** is a significant project
  (process lifecycle, port allocation, idle-shutdown, error UX).

Live exec is genuinely valuable for some workflows but the bar to
build it well is high. v1 ships static render. v2 can layer live
exec once we understand the actual use patterns.

## Data model

### New element type: `notebook`

Add to `src/types/presentation.ts` (mirror the shape of
`ImageElement` / `DemoElement`):

```ts
export interface NotebookElement extends BaseElement {
  type: 'notebook';
  /** Stable asset_id binding — see ImageElement.assetId. */
  assetId: string;
  /** Optional: subset of cells to display. Indices into the
   *  notebook's cell array. Absent = show all cells. */
  visibleCells?: number[];
  /** Optional: starting cell index for slide animation
   *  (linked-objects could reveal cells one at a time across
   *  consecutive slides — future). */
  startCell?: number;
  endCell?: number;
}
```

Add `'notebook'` to the `SlideElement` discriminated union.

### Asset storage

`.ipynb` files are JSON. Mime type: `application/x-ipynb+json` (the
RFC-blessed one). Store as a regular asset:

- `assets.data` = raw `.ipynb` bytes
- `assets.mime_type = 'application/x-ipynb+json'`
- `assets.external_path` set to project-relative path for file-watcher
  reload on edit (same pattern as demos after the recent fix)
- `external_mtime` recorded; scan-on-load + watcher both work as-is
  thanks to the recently-shipped hash-check in `scanForChangedAssets`

`asset_cache` is NOT used — the notebook renders directly from the
JSON every time. No rasterization tier.

### Detect-asset-kind plumbing

`src/lib/assetCache.ts` has `detectAssetKind(filenameOrPath, mimeType)`
that currently returns `'raster' | 'svg' | 'pdf'`. Extend to also
return `'notebook'` when:
- mime type is `application/x-ipynb+json` OR
- extension is `.ipynb`

Update the `AssetKind` union type to add `'notebook'`.

## Rendering pipeline

### Library choice

Use `@nteract/markup` + `@nteract/transforms` + `@nteract/notebook-render`
or — preferred — pin to a smaller, well-maintained library. Survey
before committing; the nteract packages are sprawling. Alternatives:

- `react-jupyter-notebook` (npm, small, opinionated)
- Roll a minimal viewer ourselves (each cell type is a couple of
  dozen lines: markdown → react-markdown, code → highlight.js, outputs
  → match mime type and render PNG / HTML / text / JSON-plotly)

Recommend: **build minimal in-house viewer** for v1. Notebooks are a
simple data structure, and the libraries are either heavyweight
(nteract) or unmaintained. Components needed:

1. **Markdown cell**: render `cell.source.join('')` via the same
   markdown renderer used elsewhere (or `marked` / `react-markdown`).
   Support GFM + math (`$..$` and `$$..$$` — pipe through MathJax
   like the rest of the app already does for text elements).
2. **Code cell**: syntax-highlighted code block (highlight.js for
   Python is well-supported and tiny). Show prompt number
   (`In [N]:`) if you want the Jupyter aesthetic.
3. **Output rendering** (each cell can have multiple outputs):
   - `stream` (stdout/stderr) → `<pre>` block
   - `execute_result` / `display_data`: dispatch by mime type
     - `text/plain` → `<pre>`
     - `text/html` → render HTML (sandboxed iframe is safest;
       trusted-paste-style marker if you want round-trip)
     - `image/png` / `image/jpeg` → `<img src="data:...">`
     - `image/svg+xml` → inline SVG
     - `application/vnd.plotly.v1+json` → optional plotly bundle (v2)
     - `application/vnd.jupyter.widget-view+json` → static fallback
       message ("widget rendering requires a kernel" — v2)
   - `error` → red-bordered traceback in `<pre>`

### Where rendering lives

Add `src/lib/notebookRenderer.tsx` exporting a `<NotebookRender
assetId, opts? />` component. Internally:

- Fetch the asset bytes via `db_get_asset_by_id` (binary IPC,
  `tauri::ipc::Response`)
- `JSON.parse` to get the notebook object
- Filter cells by `visibleCells` or `startCell..endCell` if set
- Map each cell to a React component
- Memoize aggressively — notebooks change on file-watcher events
  but not on slide-pan / element-select

### Slide canvas integration

Mirror the image/demo element pattern in
`src/components/SlideElementRenderer.tsx`:

1. Add a `<NotebookBox>` component, sibling to `<ImageBox>` /
   `<DemoBox>`. Renders `<NotebookRender assetId=... opts=... />`
   inside a `<DraggableBox>` for position/resize.
2. Wire into the main render switch.
3. Inspector: re-use `<AssetSection>` (it's already kind-agnostic;
   demos use it after the recent fix). Add notebook-specific
   controls below: a multi-select / range picker for visible cells.

### Sidebar tile

Add `SidebarNotebookTile` in `src/components/SlideSidebar.tsx`,
following the pattern of `SidebarDemoTile`:
- Calls `useAssetFileWatcher(element.assetId, element.id)` so the
  watcher subscribes
- Renders a labeled placeholder (`NOTEBOOK` or similar)

### PresentMode + presenter window

Add `<PresentNotebook>` to `PresentMode.tsx` and the presenter
window. Same rendering as the editor canvas; just no
DraggableBox wrapper.

## Insertion paths

Mirror the demo-insertion flow:

### Drag-drop from Finder

In `SlideEditor.tsx`'s `onDragDropEvent` handler, the file-extension
sniff at line ~450 currently matches `.html` for demos and
`.png|jpg|jpeg|gif|svg|webp|pdf` for images. Add `.ipynb` →
notebook branch that:
- Reads bytes via `readFile(fullPath)`
- Calls `storeAssetWithCollisionCheck` with
  `mimeType: 'application/x-ipynb+json'`, `externalPath: relativePath`
- Adds a `notebook` element at a sensible default position/size

### `+ Notebook` button in toolbar

App.tsx has `+ Demo` and `+ Image` buttons. Add `+ Notebook` that
file-picks a `.ipynb` and calls the same storage path. Default
element position: similar to demo (most of the slide).

### Paste

`.ipynb` files don't typically arrive via clipboard. Skip clipboard
support for v1.

## Inspector UI

Below the standard `<AssetSection>` block (which gives history /
reload / watch), add:

```
Cells visible
  ( ) All cells
  (•) Range  [from 0 ] to [to 5 ]
  ( ) Subset  [edit list...]
```

`visibleCells` if user picked subset; `startCell`+`endCell` if
range. Inspector reads/writes these via `updateElement`.

A "cells preview" panel could also show a thin list of cell types
(`md`, `code`) with checkboxes — overkill for v1, do later if
users ask.

## Open / save / export

- `.eigendeck` open / save: notebook elements serialize as JSON
  (the `NotebookElement` interface fields). No change to
  `db_export_json` / `db_import_json` — they JSON the elements
  array as-is.
- HTML export (`renderSlideForPrint` in `App.tsx`): emit notebook
  element as a self-contained rendered HTML block (use the same
  rendering pipeline server-side or pre-rendered into the export).
  Defer the "interactive notebook in exported HTML" case; the
  static-render is good enough.

## Implementation phases

Recommended sequence so each step is reviewable + stops at a usable
state if you have to break:

1. **Type + asset wiring**
   - Add `NotebookElement` to `src/types/presentation.ts`
   - Extend `detectAssetKind` in `src/lib/assetCache.ts`
   - Verify Rust storage handles the new mime type (it's just a
     string; no change expected)
   - Add a test that imports/exports a deck with a notebook element
     round-trip through `db_import_json` / `db_export_json`
   - Land as one commit.

2. **Minimal renderer (markdown + code + text/plain outputs)**
   - Create `src/lib/notebookRenderer.tsx`
   - Just handle markdown cells (text), code cells (no
     highlighting yet, just `<pre>`), and text-plain outputs
   - Add a vitest for parse → render shape
   - Land as one commit.

3. **Slide integration**
   - Add `<NotebookBox>` in `SlideElementRenderer.tsx`
   - Wire into the switch
   - Add `SidebarNotebookTile` in `SlideSidebar.tsx` (with
     `useAssetFileWatcher` subscription)
   - Manual test: hardcode a notebook asset, see it render
   - Land as one commit.

4. **Insertion (drag-drop + + Notebook button)**
   - Add `.ipynb` branch to `SlideEditor.tsx` drop handler
   - Add `+ Notebook` button in App.tsx toolbar
   - Test: drag a `.ipynb` from Finder → see it on the slide
   - Land as one commit.

5. **Output rendering — images + HTML**
   - Extend renderer to handle `image/png`, `image/svg+xml`,
     `text/html` (sandboxed iframe), `error` (red traceback)
   - Manual test with a notebook that has matplotlib output +
     pandas HTML output
   - Land as one commit.

6. **Syntax highlighting**
   - Add `highlight.js` (only Python language pack, ~10KB)
   - Wire code cells through it
   - Land as one commit.

7. **Inspector — cells-visible UI**
   - Extend `AssetSection` consumer (or add a new
     `NotebookOptions` section) with the cell-selection controls
   - Wire `visibleCells` / `startCell` / `endCell` through
     `updateElement`
   - Land as one commit.

8. **PresentMode + presenter**
   - Add `<PresentNotebook>` rendering same component
   - Land as one commit.

9. **HTML export**
   - Emit notebook block in `renderSlideForPrint` paths
   - Land as one commit.

10. **Documentation + mutate-notebook.py test tool**
    - Update `docs/ASSETS.md` Renderer section to mention notebook
      kind
    - Update `LLM-EDITING.md` element-type list
    - Update `SQLITE_STORAGE.md` if anything changed (probably not)
    - Add `gitignore/mutate-notebook.py` (parallel to mutate-svg /
      mutate-pdf / mutate-demo) that bumps a cell's content
      atomically so file-watcher reload can be tested
    - Land as one commit.

## Risks / open questions

- **Notebook HTML sandboxing.** Pandas DataFrames render as HTML
  tables; matplotlib SVGs are SVG; some notebooks have
  inline `<script>` tags. Decide: trust-and-render (fast, risky)
  vs sandboxed-iframe (safer, layout-awkward). Recommend sandboxed
  iframe for `text/html` outputs in v1 with a future
  "I trust this notebook's HTML" per-element opt-out.
- **Notebook file size.** Plotly-heavy notebooks can be 10s of MB
  (embedded data). `assets.data` is a BLOB — fine technically, but
  watch deck-open performance. May need lazy-load or per-cell
  fetching later.
- **Math rendering.** Notebooks use LaTeX `$...$` in markdown cells.
  Eigendeck's MathJax pipeline is per-text-element with preset-bound
  fonts; notebook math should probably use the presentation's
  default math bundle. Pipe markdown through the same MathJax
  renderer or use a notebook-specific config.
- **Cell numbering**: do we show `In [N]:` prompts? Toggle in the
  inspector, default off (cleaner look).
- **Animation between slides showing different cells.** Future:
  use the existing `linkId` / `syncId` mechanism so a notebook on
  slide 2 with cells [0..2] visible can animate to slide 3 with
  cells [0..5] visible, smoothly revealing new cells. Out of scope
  for v1 but the data model should leave room.
- **Live execution (v2).** When we get there, the data model already
  has `assetId`; the executor can fetch the source via
  `db_get_asset_by_id` and re-execute. Kernel choice (Pyodide vs
  spawned subprocess) is a separate decision.

## Test plan

- Vitest: assetCache `detectAssetKind` returns `'notebook'` for
  `.ipynb` and the right mime type.
- Vitest: notebook renderer produces expected DOM shape for a
  fixture notebook with markdown + code + image-png output + error
  traceback.
- Manual: drag-drop a fixture `.ipynb` onto a slide, save the
  deck, reopen, verify the notebook still renders.
- Manual: edit the source `.ipynb` on disk, watch the slide
  re-render via the file watcher.
- Manual: use mutate-notebook.py to test scan-on-load behavior
  (matches the mutate-svg / mutate-pdf workflow).
- Schema-compat: add a `.eigendeck` fixture with a notebook
  element under `examples/` so the schema_compat test covers it.

## What lives in `/work/.claude/notes/` already

- `pdf-plan.md` — the original PDF rendering plan (good reference
  for how to structure THIS plan's execution; similar scope)
- `asset-model-refactor-plan.md` — the asset-model phases
- `startup-notes.md` — project cold-start context

When you start: read this file, then read `docs/ASSETS.md` →
"Renderer" + "PDF rendering pipeline" sections. The notebook
feature plugs in at the same layer as the PDF arm.
