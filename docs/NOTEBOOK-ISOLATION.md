# Eigendeck Notebook Isolation — design

Status: **[v1] implemented 2026-07-05.** Companion to
[`DEMO-PLATFORM.md`](DEMO-PLATFORM.md) (opaque-origin isolation for demo HTML) and
to [`ASSETS-SECURITY.md`](ASSETS-SECURITY.md) (the trust/read model for assets).
This document owns the *why* and the *rules* for how an embedded notebook's
rendered output stays isolated from the app while keeping interactive widgets
interactive.

Each section marks what is **[v1]** (the security fix) vs **[deferred]** (designed
here so the foundation accommodates it, built later).

---

## 1. Purpose & context

A `.eigendeck` is an untrusted file people share. A notebook element embeds a
Jupyter `.ipynb` plus an *overlay* (recorded outputs, source edits). Three of the
notebook's render paths currently `dangerouslySetInnerHTML` attacker-controllable
strings straight into the **privileged main webview** (the one with Tauri IPC and,
today, `fs:*-all`):

- **`CellOutput.tsx`** — code-cell outputs `text/html` (pandas, Plotly, ipywidgets)
  and `image/svg+xml` (matplotlib). Audit finding **C-1**.
- **`MarkdownCell.tsx`** — markdown source rendered by `marked()`, which passes raw
  HTML through by default. Audit findings **C-2 / C-5**.

A crafted deck ships an "output" of `<img src=x onerror="read ~/.ssh; POST to
attacker">` and gets arbitrary JS in the privileged frame on merely opening or
presenting the deck. Notebook cell *source* is not a sink (it renders as text in a
code editor, never as markup), and the kernel client / overlay / merge logic are
our own trusted code operating on data-as-text. So the attack surface is exactly
these rendered-HTML/SVG blobs.

(The sibling math-SVG sink **C-4** and the history-preview sink **H-2** are
*slide-text* paths, already fixed by inline sanitization — see
`src/lib/sanitizeHtml.ts`. This document is only about notebook output.)

## 2. The model: contain, don't authorize

The instinct is to copy JupyterLab: sign outputs you generate with a per-machine
secret key, render trusted output raw, sanitize untrusted. We deliberately **do
not** do this.

Jupyter needs a trust signature because it renders trusted output **un-sandboxed,
in the page** — the signature is the only thing between "your output" and a
stranger's `<script>`. We are adding a **containment layer** (an opaque-origin
sandboxed iframe, the same one demos use), so a script from an untrusted output
physically cannot reach Tauri no matter who wrote it. Once containment exists,
authorization is moot: there is nothing left for a signature to gate.

Dropping the trust model is also strictly better for the product goal:

- **No key management, no signing on every run, no "your deck is untrusted on your
  travel laptop."** All of that evaporates.
- **Shared decks stay interactive.** A colleague opening your deck gets a *zoomable*
  Plotly chart with no kernel running, because the output is contained and
  therefore safe to run regardless of origin. The trust model specifically could
  not do this (their machine can't verify your signature).

The rule is therefore: **contain script-bearing output; never authorize it.**

## 3. Output taxonomy & routing

An output is routed by whether it carries executable content, not by who authored
it. Most outputs are static and never need an iframe.

| Output | Path | Rendering |
|--------|------|-----------|
| `image/png`, `image/jpeg` | inline | `<img src="data:…">` — always safe, unchanged |
| `text/plain`, stream, error | inline | `<pre>` text — never was a sink |
| `image/svg+xml` | inline | **sanitize** via `sanitizeSvg` (lossless for plots; SVG interactivity is vanishingly rare) |
| `text/html` **without** scripts (pandas tables, styled divs) | inline | **sanitize** via `sanitizeHtml` (DOMPurify HTML profile) |
| `text/html` **with** scripts (Plotly, ipywidgets, bokeh) | **iframe** | raw HTML in an opaque-origin sandbox — contained + interactive |
| markdown cell (`marked()` output) | inline | **sanitize** via `sanitizeHtml` — prose, never needs `<script>` |

So iframes appear **only where there is real interactivity to preserve**, one per
interactive widget, not one per cell. A notebook of matplotlib plots and dataframes
gets **zero** iframes; a Plotly cell gets one.

## 4. Detecting interactive output  **[v1]**

`text/html` is routed to the iframe iff it contains content that inline
sanitization would strip, i.e. executable content:

```
outputWantsScripts(html) =
  has <script> | <iframe> | <object> | <embed>
  | any on*= handler attribute
  | any javascript: / data:text/html URL
```

Implemented by parsing once (`DOMParser`) and scanning, or equivalently: sanitize,
and if the sanitized string lost executable nodes/attrs vs the original, treat the
original as interactive. False positives are harmless (an over-eager iframe still
renders correctly); false negatives are impossible (anything a sanitizer would
strip is, by definition, detected). Static output therefore never pays iframe cost,
and nothing script-bearing ever renders inline.

## 5. The interactive-output iframe  **[v1]**

Reuse the demo containment stack (`DEMO-PLATFORM.md` §2, §6, §16):

- **Opaque origin.** `sandbox="allow-scripts"` over a `blob:` document (no
  `allow-same-origin`). No `window.top`, no Tauri, no parent DOM, no cookies.
  Internet is available unless the deck's block-internet toggle is set
  (`DEMO-PLATFORM.md` §3) — a Plotly CDN load works; an inlined bundle works offline.
- **Document build.** Extract the doc-assembly core of `demoMount.getDemoDocumentUrl`
  into `buildIsolatedDoc(html, opts)` so it works from an inline HTML string (the
  output) as well as from a fetched asset (a demo). The output document is
  `raw output html + injectDemoBridge(...) + injectDemoThemeIntoHtml(...)`, blobbed.
- **Theme.** Splice the deck's `--eigendeck-*` vars + data-URL fonts at build
  (`injectDemoThemeIntoHtml`), so a Plotly chart picks up the slide's colors/fonts.
  A theme switch remounts (new blob), same as demos.
- **Clocking.** The interactive iframe carries the shared `el-demo-frame` class so
  the parent rAF pump (`useDemoHost`, already armed by SlideEditor + PresentMode)
  drives its animation frames at 60fps despite the cross-origin throttle
  (`DEMO-PLATFORM.md` §16). No new host wiring.
- **Self-sizing.** The injected bridge gains a height reporter: a `ResizeObserver`
  on `document.body` posts `{__eigendeck:1, type:'output-size', h}` to the parent;
  the parent sets the iframe height. Width is the cell's content width. This is the
  one net-new mechanism vs demos (a demo owns a fixed box; an output must grow to
  its content).

## 6. Inline sanitization  **[v1]**

Static output and markdown go through DOMPurify (already a dependency,
`src/lib/sanitizeHtml.ts`):

- `sanitizeHtml(html)` — DOMPurify HTML profile. Keeps tables, headings, lists,
  links, `<img>`, styled spans; drops `<script>`, `on*=`, `javascript:`, `<iframe>`,
  `<object>`. Force `rel="noopener noreferrer"` on links; links open externally.
- `sanitizeSvg(svg)` — the existing SVG profile (used for math), with `<use>`
  constrained to in-document `#fragment` refs.

No trust bit, no signature, no per-machine key anywhere in this design.

## 7. Interactivity: what works, what doesn't

Per-output isolation is honest about one limit: a notebook output is authored
assuming a **page-level runtime that loaded once** for the whole notebook, not as
an independent document. So the guarantee is scoped to *self-contained* output.

- **Works:** any output that carries its own runtime — Plotly with
  `include_plotlyjs=True` (or a per-figure loader), self-contained JS/HTML widgets.
  It runs in the sandbox, talks to no one, and is now safe. Static matplotlib
  (png/svg) and pandas tables were never affected; they render inline as before.
- **[deferred] Shared page runtime.** Outputs that assume a library loaded *once*
  elsewhere on the page (Plotly `include_plotlyjs='cdn'` across several figures,
  bokeh) can't see that shared global from their own `blob:` document, so a later
  figure may not render. The fix is a coarser boundary (one iframe for the whole
  notebook output region so the runtime loads once) — deferred until measured need.
- **Not a regression: live ipywidgets.** ipywidgets never worked (no
  `widget-view` mimetype renderer, no Comm protocol in the kernel client). This
  design does not preserve them because there is nothing to preserve; building them
  is tracked in **#119**, where they arrive over a relayed Comm channel to the
  output iframe.
- **Live-kernel path unchanged.** When a kernel is attached and a cell is re-run,
  its fresh output flows through the same router (static inline, interactive in an
  iframe). Running a cell is already arbitrary code execution via the kernel; the
  *rendering* of its output stays contained either way.

## 8. Preview/thumbnail & export parity

- **Thumbnails.** The sidebar/preview capture can't read an interactive output
  iframe's DOM (opaque origin), same as demos. Reuse the in-iframe capture round-trip
  (`demoMount.requestDemoCapture`, `DEMO-PLATFORM.md` §8) for interactive outputs;
  static (inline) output is captured normally.
- **Static HTML export.** The export path stays same-origin `srcdoc` for isolated
  content (`exportCore.mjs`, `DEMO-PLATFORM.md`), which is correct: an exported deck
  is a standalone file opened in a plain browser with no Tauri to reach. Export
  sanitizes static output inline and wraps interactive output in the same sandboxed
  `srcdoc` iframe it uses for demos.

## 9. Security invariants

1. No notebook-derived HTML/SVG reaches the privileged frame's DOM un-sanitized.
   Static output is DOMPurify'd inline; interactive output runs only inside an
   opaque-origin sandbox with no line to Tauri.
2. Opening or presenting an untrusted deck executes **no** deck-authored script in
   the privileged origin. (Contrast the current C-1/C-2 behavior.)
3. The isolation is origin-based and unconditional — there is no trust flag, key,
   or signature that a crafted deck could forge or that could be misconfigured.
4. Block-internet (per-deck / global, restrictive-only) applies to interactive
   output iframes identically to demos.

## 10. Phased delivery

- **[v1] — DONE (2026-07-05).** Static output + markdown sanitized inline
  (`sanitizeHtml`/`sanitizeSvg`); script-bearing `text/html` mounted in the
  opaque-origin iframe (`buildIsolatedOutputUrl` + `IsolatedOutput` + the
  `reportSize` bridge), routed by `outputHasExecutable`. Closes C-1, C-2, C-5.
  Covered by unit tests on the sanitizers + detector and a `CellOutput` routing
  test (static→inline, executable→`allow-scripts` iframe, svg sanitized).
  Remaining verification: an e2e that opens a deck whose output carries
  `<img onerror>` and asserts no privileged execution (bridge self-report, like
  the demo probes); a real-app visual check that self-contained Plotly stays
  interactive.
- **[deferred] — whole-notebook-output iframe** to restore shared-page-runtime
  widgets (§7), if measured need arises.
- **[deferred] — live ipywidgets over a relayed Comm channel** (#119).

## 11. Files

- `src/components/notebook/CellOutput.tsx` — route by output type; `SanitizedBlock`
  inline or `IsolatedOutput` iframe. *(done)*
- `src/components/notebook/IsolatedOutput.tsx` — opaque iframe + self-sizing. *(done)*
- `src/components/notebook/MarkdownCell.tsx` — sanitize `marked()` output. *(done)*
- `src/lib/demoMount.ts` — `buildIsolatedOutputUrl(html, opts)`; `reportSize`
  bridge option in `src/lib/demoBridge.ts`. *(done)*
- `src/lib/sanitizeHtml.ts` — `sanitizeHtml` (HTML profile) + `outputHasExecutable`
  alongside `sanitizeSvg`. *(done)*
- **[deferred]** `src/lib/notebookExport.tsx` / `exportCore.mjs` — export parity
  (the static-HTML-export surface, separate from the in-app privileged frame).
