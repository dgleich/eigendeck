# Eigendeck Development Log — May 31 – June 1, 2026 (Notebooks)

> Migrated from the old root `CHANGELOG.md` (2026-07-07). The May 19–25 asset
> versioning work that preceded this already has its own detailed entry in
> `worklog-2026-05-19-to-05-25.md`; this is the notebook work that followed.

Live Jupyter notebook elements on slides. Drop a `.ipynb` from Finder (or
`+ Notebook` toolbar button); cells render natively in the slide; click ▶ on a
code cell to spin up a kernel and see output live. External Jupyter server (any
language: Python, Julia, R, ...) is the v1 backend; JupyterLite/Pyodide
("portable demo for anyone") is wired in the type / cascade but defers
display-only until v1.5.

Branch `feat/notebook-spike`; squashed history covers spikes → data model →
renderer → kernel → PresentMode → docs.

## Architecture choices (see DESIGN_DECISIONS.md "Notebooks")

- **Native cell rendering** instead of an iframe with JupyterLab. Lighter, themes
  match the slide, scrolling/selection are native, no postMessage IPC for display.
- **On-demand kernel boot**: no WS connection until the user clicks ▶ on a cell.
  Scrolling a slide with a notebook on it never starts a kernel.
- **Dual-backend type, single-backend runtime**: NotebookElement.kernel is
  `{ kind: 'external', ... } | { kind: 'lite' }`. External is proven and wired
  end-to-end; lite has a placeholder banner and display-only fallback. Lite
  implementation is v1.5 work.
- **Default-setting cascade** (DESIGN_DECISIONS.md "Preferences cascade"):
  NotebookElement.kernel → PresentationConfig.notebookKernel → app default
  `{ external, localhost:8888, python3 }`. Fields cascade independently so a deck
  can set baseUrl while individual elements override kernelName.

## Spike (validated headless then in real Tauri)

`public/notebook-spike/` — Spike A (external-kernel.html) and Spike B (built
JupyterLite dist, gitignored, see spike-tools/setup.sh). Both pass in Chromium +
Playwright WebKit; David confirmed Spike A in real Tauri WebKit via Safari with
both Python and Julia kernels.

## v1 limitations / open work

- **No in-eigendeck cell editing yet.** Source is read-only; user edits in
  JupyterLab / VSCode, file-watcher reloads. CodeMirror swap-in is the natural
  next step.
- **Outputs are session-scoped.** Running a cell shows output but doesn't persist
  back to the .ipynb. Reloading the slide loses live outputs. Explicit "Save
  outputs to notebook" button is a v1.5 candidate.
- **Kernel state dies on slide nav.** Iframes/state are not hoisted across slides.
  Hoisting is a v1.5 conversation.
- **No syntax highlighting.** Source renders as plain monospace `<pre>` for now.
  Comes free with the CodeMirror swap-in.
- **Token in deck.** `.eigendeck` files include the auth token if the user sets
  one in the inspector. Acceptable for localhost workflows; v2 moves to an
  app-prefs server registry keyed by baseUrl.

## Test coverage

195 tests pass. New: `notebookParser.test.ts` (8 tests, all output kinds +
language inference + malformed input), `notebookKernel.test.ts` (7 tests covering
cascade + lite short-circuit + token handling), `assetCache.test.ts` (detect
helpers).

## TODO at end of session

- **Small**: Insertion collision dialog (Update / Import as new / Cancel). Global
  pref UI toggle.
- **Medium**: Demo snapshots (issue #59, schema already reserves
  `asset_cache.variant`). Editor canvas via `asset_cache` (probably defer
  indefinitely).
- **Large**: pdfium PDF rendering — PDF clipboard payload is stored today but
  renders as placeholder. Adds ~10 MB to macOS bundle.
- **Long-term**: PowerPoint drag. Cross-platform clipboard (swap `pasteboard.rs`
  for `clipboard-rs` when Windows/Linux become real targets).
