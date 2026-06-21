# Notebook HTML export — one renderer, no drift

## Goal

In the **interactive HTML export** (Path A, `exportCore.mjs`), a notebook must be
**scrollable and explorable** — its actual cells (markdown, syntax-highlighted
code, recorded outputs incl. plots/tables/images), not a cropped preview PNG. No
kernel is needed: a notebook with recorded outputs is just rendered content.

The hard requirement: the export must render through the **same code** as the
live view, so the two **cannot drift**. The PNG stays only as a cold/CLI
fallback.

## Why a PNG today

Notebooks render as React (`NotebookBox → NotebookContent`), not iframes, so
there's no HTML string to grab. The agent that added export support punted to the
cached preview PNG ("can't run live in a static export") — true for *running*,
false for *displaying*.

## The split that matters

`NotebookContent` has two layers:

- **Leaf cell renderers** — `MarkdownCell({cell})`, `RawCell({cell})`,
  `CodeCell({…})` — pure: model in, DOM out. All handlers optional; the Run
  button only renders when `onRun` is passed (`CodeCell.tsx:157`). **Reusable.**
- **The container** (`ExternalKernelBody`) — coupled to live hooks (`useKernel`,
  `useOverlay`, `usePresentationStore`, `usePreference`, async `useNotebook`).
  Cannot run inside `renderToStaticMarkup`. **Not reusable as-is.**

The cell-mapping (`merged.map(...)` → which leaf component per cell, with which
props) is the thing that must not drift. Today it lives inside
`ExternalKernelBody`'s JSX.

## Design

### 1. Extract `<NotebookCells>` — the single source of truth

Pull the header + `nb-body` + `merged.map(...)` out of `ExternalKernelBody` into
one component used by **both** the live view and the export:

```tsx
function NotebookCells({
  merged, language, highlight, dark, baseSize, showLineNumbers,
  hideHeader, kernelDisplayName, live,
}: {
  merged: MergedCell[];
  language: string | null;
  highlight: boolean; dark: boolean; baseSize: number;
  showLineNumbers?: boolean;
  hideHeader: boolean; kernelDisplayName: string | null;
  /** Present = interactive (live view). Absent = read-only (export). */
  live?: {
    running: Map<string, RunningState>;
    working: Map<string, string>;
    editable: boolean;
    execute: (key: string, source: string, record: Recorder) => void;
    setWorking: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    ov: OverlayApi;
  };
}) { /* the exact merged.map body, today's JSX */ }
```

- **Live** (`ExternalKernelBody`): passes `live={{ running, working, editable,
  execute, setWorking, ov }}` → identical to today (run buttons, editing,
  spinners).
- **Export**: passes **no `live`** → outputs/exec-counts come from the merged
  model, no handlers, `editable=false`, `pointer-events:none`. Same components,
  same classes ⇒ cannot diverge.

`ExternalKernelBody` keeps the live-only chrome (`<StatusDot>`) and renders
`<NotebookCells … live={…} />`. Net effect on the live view: a pure refactor,
guarded by the existing notebook tests.

### 2. Pre-resolved syntax highlight

`CodeCell` highlights via an async `useEffect` that `renderToStaticMarkup`
won't run. Add an optional `highlightedHtml?: string` prop: when set, render it
directly; else the existing async path (live unchanged). The export pre-runs
`highlightCode(source, language)` for each code cell and passes the result —
same `CodeCell`, same markup.

### 3. One stylesheet (`notebook.css`)

Move the `.nb-*` rules out of `App.css` into
`src/components/notebook/notebook.css`. The app imports it normally; the export
inlines it via Vite `?inline`. One source ⇒ CSS can't drift either.

### 4. App-side builder + the export callback

`exportCore.mjs` is plain JS (no React), so React rendering happens app-side and
is passed in — exactly like the existing `renderTextElement` (text → SVG). Add:

```ts
// src/lib/notebookExport.ts (app/TS only)
async function renderNotebookElementHtml(el, getAssetBytes): Promise<string> {
  const nb = parseNotebookBytes(await getAssetBytes(el.assetId));
  const overlay = /* load via getAssetBytes(overlayAssetId) + deserializeOverlay, else empty */;
  const merged = filterMerged(mergeNotebook(nb, overlay), el);
  const highlights = await Promise.all(codeCells.map(c => highlightCode(c.source, nb.language)));
  const body = renderToStaticMarkup(<NotebookCells merged … />); // no `live`
  return `<iframe srcdoc="… <style>${notebookCss}</style> <div class="nb-frame …">${body}</div> …"
            style="… scroll …"></iframe>`;
}
```

Wrap in a **`srcdoc` iframe** (style isolation + independent scroll), sized to
the element box, with `--nb-*` font/theme CSS variables set from the element +
slide theme (same as live).

### 5. exportCore wiring — same three-tier fallback as other elements

`buildExportHtml` gains a `renderNotebookElement(el, slide) → Promise<string>`
opt. The notebook case becomes:

1. `renderNotebookElement` HTML (scrollable, full fidelity) — when provided
   (app export), else
2. cached preview PNG (`getElementPreview`) — warm cache, else
3. the `NB` placeholder.

`fileOps.ts` passes `renderNotebookElement`. The **CLI/headless** paths (no
React) pass nothing → PNG/placeholder, unchanged. (A future JS serializer could
extend full fidelity to the CLI; out of scope here.)

## Non-goals

- Live kernels in exported HTML (impossible without bundling Pyodide/JupyterLite;
  recorded outputs are shown instead).
- CLI/headless full-fidelity notebooks (React-only for now; PNG fallback).
- Lite-backend path changes (`LiteKernelPlaceholder` stays; could later share
  `NotebookCells`).

## Verification

- Existing notebook tests still pass after the `NotebookCells` extraction (live
  view unchanged).
- New unit test: `renderNotebookElementHtml` over a fixture `.ipynb` emits the
  markdown text, the code source, and a recorded output — and contains no run
  buttons / editor.
- `npm run build` + full `vitest`.
- Manual (Mac): export the stress deck, confirm the notebook scrolls and shows
  cells/outputs.
