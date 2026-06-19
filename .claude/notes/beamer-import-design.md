# Beamer → Eigendeck Importer — Design

**Date:** 2026-06-03
**Status:** Approved design, pending implementation plan
**Author:** David Gleich (with Claude)

## Goal

A command-line tool that converts a Beamer `slides.tex` into a
`slides.eigendeck` file whose content remains fully editable in
Eigendeck. The aim is a **migration on-ramp** to tempt Beamer users
across — not a pixel-perfect renderer.

Fidelity target is **"between a proof-of-concept and a practical
workhorse" (A→B)**: handle the common Beamer idioms (title, frames,
itemize, blocks, columns, formatting, color, math, graphics, simple
tables, code listings, and overlay builds) well enough that a real
talk comes through and needs only modest hand-tuning afterward. Messy
or exotic decks may come through rough, and that is acceptable.

### Non-goals

- Pixel-perfect layout fidelity (impossible flow→absolute; see Layout).
- Full TeX macro expansion / a complete LaTeX engine.
- Preserving Beamer theme chrome (headlines, footlines, sidebars,
  navigation symbols) — chrome is intentionally stripped.
- TikZ/PGF picture rendering (dropped with a warning in v1; a future
  enhancement could shell to LaTeX to compile each picture to PDF/SVG
  and embed it as an image).
- Bibliography/`\cite` resolution beyond passing the raw key through as
  text.

## Approach

**Real LaTeX parser library + our own mapping** (chosen over Pandoc and
over a hand-rolled scanner). We use [`@unified-latex`](https://github.com/siefkenj/unified-latex)
(JS) to tokenize the `.tex` into a robust AST — it handles braces,
macros, and environments correctly — and we write the Beamer→Eigendeck
mapping ourselves. This dodges Pandoc's lossiness on exactly the things
we care about (blocks, colors, columns) while not reinventing the
tokenizer.

The tool is a Node ESM script in `tools/` (consistent with the existing
`tools/*.mjs` ecosystem, e.g. `export-eigendeck.mjs`).

### Pipeline

```
slides.tex
  → @unified-latex (parse to AST)
  → beamer-mapper (our logic)
      ├─ presentation.json           (slides + elements, referencing assetIds)
      └─ asset manifest              (assetId → generated file: .png/.html/.ipynb)
  → eigendeck-cli import json presentation.json     (loads slides/elements)
  → eigendeck-cli store-asset <file> --id <assetId> --as <label>   (per asset)
  → slides.eigendeck
```

The converter mints every `assetId` (UUID v4), writes it onto the
element, and then loads the bytes under that same id.

### OPEN DECISION (defer to build time): how the file gets written

Three options for turning the converted model into a `.eigendeck` file:

- **(a) Shell out to `eigendeck-cli`** (`import json` + per-asset
  `store-asset`). The Rust app stays the *single authority* on schema
  correctness (migrations, the ISO-8601+monotonic-counter timestamp
  format, promoted columns). Requires a built binary at
  `src-tauri/target/release/eigendeck-cli`. Zero schema duplication.
- **(b) Write SQLite directly** from the converter (Node `better-sqlite3`
  or Python `sqlite3`). Fully self-contained, no binary dependency. The
  catch is it duplicates schema knowledge — but for a *freshly
  converted* deck this is modest: every row is a single current version
  (`valid_to = NULL`, one timestamp), `_meta.schema_version = '3'`, a
  fresh `project_id`. Risk is drift when the schema bumps.
- **(c) Build a reusable Eigendeck file-format library** (e.g. a Python
  `eigendeck` package, or a shared JS module) that encapsulates
  reading/writing the format. The converter builds a model and calls the
  library; the library is reusable by other tooling beyond this
  importer. Highest up-front cost, best long-term leverage. **Preferred
  direction if we invest** (David's lean).

**Language coupling:** option (c) as a Python library likely pulls the
whole tool to Python (parser → `TexSoup`/`plasTeX` instead of the
Node `@unified-latex` assumed above). Decide writer + parser together.

For a quick first cut, (a) is the least code. For anything we intend to
maintain, (c) is the target. Pick at build time.

### CLI surface

```
beamer-import slides.tex [-o slides.eigendeck] [--report report.txt]
```

Defaults output next to the input (`slides.eigendeck`). Emits a
**conversion report** listing every dropped or approximated construct
with source line numbers.

## The "box" decision: C now, B later

Eigendeck has **no box primitive today**: `TextElement` has no
background/border, and the only filled rectangle is `cover` (a plain
colored rect). A Beamer `block` (titled, colored, rounded rectangle)
therefore has no one-element equivalent.

**Decision: implement option C now, architect for B later.**

- **C (now):** a `block`/`alertblock`/`exampleblock` maps to a single
  `text` element — a bold, colored title line followed by the block
  body. No background chrome.
- **B (future):** when Eigendeck gains a real box capability (optional
  `backgroundColor` / `borderColor` / `borderRadius` / `padding` on
  `TextElement`, or a new `box` element), a block becomes one cohesive
  editable box.

To make the C→B switch a localized change, all block emission goes
through a **single `emitBlock(title, contentNodes, colorInfo)` seam**.
Today it emits a text element; later it emits a box. Block color/kind
metadata is carried in a structured intermediate so the swap touches
only that function.

## Content mapping

| Beamer | Eigendeck output | Notes |
|---|---|---|
| `\begin{frame}` / `\frametitle{}` | one slide + `title` text element | one frame = one slide (before overlay expansion) |
| `\titlepage` / `\maketitle` + preamble `\title`/`\author`/`\date`/`\institute` | title slide: `hype`/`title` + `annotation` elements; also fills `config.author` / `config.venue` | pulled from preamble |
| `itemize` / `enumerate` (nested) | `body` text element, `<ul>`/`<ol>` HTML | nesting preserved |
| `\textbf` | `<b>` | |
| `\textit` / `\emph` | `<i>` | |
| `\sout` / strikeout | `<s>` | |
| `\underline{x}` | `x` (command stripped, text kept) | underline never supported |
| `\texttt` / `\verb` (inline) | `<span style="font-family:monospace">` | revisit when a code element exists |
| `\textcolor{c}{}` / `{\color{c} }` / `\alert{}` | `<span style="color:#hex">` | xcolor named colors → hex map; `\definecolor` honored |
| `block` / `alertblock` / `exampleblock` | `text` element: bold colored title line + body (the **emitBlock seam**) | C now, B later |
| `columns` / `column` | side-by-side `text`/image elements; body width split by column widths | |
| `$..$` / `\(..\)` | inline LaTeX passed through in `html` | both sides use MathJax |
| `\[..\]` / `equation` / `align` | centered display-math `text` element (`$$..$$`) | |
| `\includegraphics[..]{f}` | `image` element; file ingested as asset | path resolved relative to the `.tex`; `\graphicspath` honored |
| `tabular` / `table` | `demo` element wrapping a generated self-contained HTML `<table>` asset | editable as HTML; styled to match |
| `verbatim` / `lstlisting` (block) | `notebook` element: generated 1-cell `.ipynb` asset, `editable:false`, `autoRun:false`, `syntaxHighlight:true` | language from `\lstset`/`[language=…]` → kernelspec |
| `\pause` / `\only<>` / `\onslide<>` / `\uncover<>` | **overlay build** — see below | |
| `\section` / `\subsection` | optional section-divider slide (centered title) | |
| unknown command/environment | dropped; **logged in conversion report** with line number | inner text kept where sensible |

### Math notes

- Inline `$..$` and `\(..\)` pass through unchanged inside `html`.
- Display math becomes its own centered `text` element using `$$..$$`.
- Preamble `\newcommand`/`\def` are collected and written to
  `config.mathPreamble` so MathJax has the same macros available.

## Layout strategy (flow → absolute)

Beamer is flow-based (content stacks automatically); Eigendeck is
absolute-positioned (every element has x/y/w/h in a 1920×1080 space).
A frame body is converted by a **vertical flow engine**:

- **Title** at top: roughly `x:80, y:30, w:1760, h:120`.
- **Body region**: roughly `y:180 → 1010`, `x:80 → 1840` (width 1760).
- Walk top-level content nodes in source order and **stack** them,
  estimating each box's height heuristically (itemize item count;
  characters-per-line wrapping at the resolved font size × line-height)
  to place the next box below it.
- `columns` split the body width proportionally to column widths;
  each column runs its own vertical flow.
- 16:9 frames map straight; 4:3 frames are centered/letterboxed into
  the 16:9 canvas.

**Design philosophy that makes this acceptable:** the output is fully
editable, so the bar is *"close enough to hand-tune in a few minutes,"*
not *"pixel-perfect."* Height estimation without a real
text-measurement pass is approximate — boxes will sometimes overlap or
leave gaps — and that is an accepted limitation, mitigated by option C
(no box chrome) keeping the layout math simpler.

## Overlays → builds (Model A: cover-reveal)

A frame containing overlay specifications expands into **N slides that
share one `groupId`** (one Eigendeck build; group members share a slide
number and animate as one logical step). N = the number of distinct
overlay steps in the frame.

**Primary model — A (cover-reveal):**

1. Lay out the **full final frame once**. Every step-slide carries the
   same content elements, linked via `syncId` so the content is
   authored/edited in one place.
2. For step *k*, overlay `cover` rectangles (filled with the slide's
   background color) over the regions of elements not yet revealed at
   step *k*.
3. Covers carry `linkId`s so that, from one step to the next, a cover
   that is removed **lifts/fades away** in the presenter — producing the
   progressive reveal.

This is the most faithful realization of "covers + builds + linked
elements," and because content is laid out once, editing stays simple.

**Fallback — B (present-on-steps) for replacement overlays:** when an
`\only<k>`/`\onslide<k>` genuinely *replaces* content at a location
(different content on different steps rather than additive reveal), the
differing elements are emitted only on the step-slides where they apply,
fading in via `linkId`. Cover-reveal is for additive `\pause`/`\uncover`;
present-on-steps is for replacement.

Overlay parsing must understand the common spec forms: `\pause`,
`<2->`, `<2-3>`, `<2>`, `\item<3->`, and the `\only` / `\onslide` /
`\uncover` / `\visible` commands. Anything outside this set is flattened
(shown on all steps) and logged.

## Asset handling & the Phase 0 prerequisite

`db_import_json` does **not** carry asset bytes — it loads only
slides/elements. Assets enter via a separate `store-asset` command.
`db_store_asset` already accepts an explicit `asset_id: Option<String>`
(storage.rs:1762), but the CLI's `cmd_store_asset` hardcodes `None` and
has no flag to set it.

**Phase 0 (prerequisite):** add a `--id <uuid>` flag (and, for
convenience, `--mime <type>`) to `cmd_store_asset` so the converter can
bind generated assets to the exact `assetId`s it minted onto the
elements. Small, contained Rust change.

## Error handling

- **Conversion report:** every dropped or approximated construct is
  recorded with its source line number and a short note (e.g.
  "tikzpicture dropped at line 142", "tabular approximated as HTML demo
  at line 88"). Written to `--report` (default: printed to stderr at the
  end with a summary count).
- **Unknown commands:** the command wrapper is dropped; inner text is
  kept where that is sensible (e.g. an unknown one-arg text command),
  otherwise the node is skipped. Never abort the whole conversion for
  one bad node.
- **Missing graphics files:** emit a placeholder image element + a
  report entry rather than failing.
- The tool exits 0 on a completed conversion (even with warnings) and
  non-zero only on unrecoverable parse failure.

## Testing

- **Unit tests (Vitest):** per-construct mapping tests — feed a small
  `.tex` fragment, assert the produced `presentation.json` elements
  (formatting → HTML, color → hex, block → titled text, itemize → list,
  overlay → group + covers, etc.). These are deterministic and fast.
- **Corpus tests:** run the converter over a large corpus of real
  Beamer decks. Assert it runs to completion, produces a deck that loads
  cleanly under the current schema (reuse the `validate` path /
  `tools/check_deck_history.py`), and that the conversion report is
  reasonable. Spot-check a sample visually in the app.

### Test corpus acquisition plan

The converter consumes **`.tex` source**, not PDFs — a compiled Beamer
PDF cannot be un-compiled into editable frames. So the corpus we collect
is `.tex`. PDFs play two supporting roles: (1) **ground truth** for
visual spot-checks (compile-the-source vs. converted deck), and (2) a
**discovery signal** — a Beamer-generated PDF is strong evidence that
editable source lives nearby (same repo / sibling URL).

Sources, richest first:

1. **GitHub code search (primary vein).** Beamer sources are reliably
   identifiable by `\documentclass[...]{beamer}` + `\begin{frame}`.
   - `gh search code '\documentclass{beamer}' --extension tex` (auth'd;
     paginate; mind code-search rate limits), and `usetheme` /
     `\begin{frame}` as secondary queries.
   - Broaden with **Sourcegraph** / **grep.app** regex search across
     public repos for the same markers.
   - Bias toward repos named `slides` / `talks` / `presentations` /
     course-material repos — these are real talks, not just templates.
   - Pipeline: dedup by repo → shallow clone → find the main file (has
     both `\documentclass...beamer` and `\begin{document}`) → resolve
     `\input`/`\include` and `\includegraphics`/`\graphicspath` assets →
     keep reasonably self-contained decks.

2. **Overleaf gallery + template repos.** Downloadable `.tex` for theme
   and idiom diversity (Metropolis, Madrid, Frankfurt, CambridgeUS…).
   Great construct coverage, less "real-talk messiness."

3. **Conference / course / lab websites.** Many authors post
   `slides.pdf` *and* `slides.tex` (or a `src/` / `.zip`). A small
   crawler that, given a Beamer-looking PDF, probes sibling URLs
   (same-name `.tex`, `.zip`, `/src/`) recovers a lot of source. Detect
   "made with Beamer" from PDF metadata (Producer `pdfTeX`/`LaTeX`;
   Creator sometimes names beamer) and 16:9 / 128×96mm slide geometry.

4. **Zenodo / OSF / figshare.** Researchers deposit talk materials,
   often including source — permissively licensed, citable.

**Coverage matrix.** Tag each collected deck by the constructs it uses
(columns? blocks? overlays/`\pause`? `tikz`? `lstlisting`? `tabular`?
custom colors?) and curate so the corpus spans every row of the mapping
table — guarantees the mapping/overlay tests hit each construct.

**Licensing.** Vendor (commit as fixtures) only permissively-licensed /
public-domain decks. For everything else, keep a **URL list + fetch
script** rather than copying source into the repo.

## Phasing

- **Phase 0 (prereq, small):** `store-asset --id` (+ `--mime`) CLI flag.
- **Phase 1 (the A→B core):** preamble→title slide + `config.author/venue`;
  frames→slides; frametitle; itemize/enumerate; bold/italic/emph/strike;
  color (xcolor names + `\definecolor`); inline + display math;
  blocks→bold-title text (the emitBlock seam); columns→side-by-side;
  `\includegraphics`→image asset; conversion report. **Overlays
  flattened** (shown fully, no builds).
- **Phase 2:** `lstlisting`/`verbatim`→notebook; `tabular`→HTML demo.
- **Phase 3:** overlays→builds (Model A cover-reveal, Model B fallback).
  Highest complexity — built last.

Each phase is independently useful; Phase 1 alone is a shippable
milestone.
