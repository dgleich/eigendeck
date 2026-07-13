---
name: eigendeck
description: Orientation and routing skill for Eigendeck, a desktop app for building presentations with embedded interactive demos and LaTeX math. Start here whenever a user wants to build, edit, inspect, or design an Eigendeck presentation and it is NOT obvious which specific area applies. Gives the deck/slide/element mental model at a glance, then routes to the specialized sibling skills (headless CLI editing, the raw-HTML design element, interactive JavaScript demos, and bold full-bleed designer slides). Use this to get your bearings, then hand off to the right sibling.
---

# Eigendeck

Eigendeck is a desktop app for building **presentations** with embedded
**interactive HTML/JavaScript demos** and **LaTeX math**. It is aimed at
technical talks (math, algorithms, research). A presentation is a single
**`.eigendeck` file** — a SQLite database holding every slide, element, and
embedded asset, plus a full temporal edit history (so every change is
undo-safe).

This is the **entry-point** skill. It orients you to the data model, then points
you at the sibling skill that goes deep on whatever you're actually doing.

## The mental model (learn this first)

Everything is a **positioned element on a 1920×1080 canvas**. There is no fixed
template — titles, body text, images, arrows, demos are all draggable,
resizable elements. Three levels:

```
Deck (.eigendeck)                          config: fonts, theme, math preamble, 1920×1080
 └─ Slides[]           (array order = presentation order)   theme / font overrides, speaker notes
     └─ Elements[]     (array order = z-order, first = back)  each is a typed, positioned box
         └─ Assets      images / demos / notebooks / video, stored as bytes in the deck, referenced by assetId
```

Key facts that shape everything:

- **Coordinates are slide-space, 1920×1080, origin top-left.** A `position` is
  `{ x, y, width, height }`. The app scales the canvas to fit any screen, so a
  48px font looks the same on any projector. Author at native resolution — sizes
  are large.
- **Element order within a slide is z-order** (first = bottom, last = top).
- **Slide order is presentation order.** Slides can share a `groupId` to form a
  build group (shared slide number, moved together — used for step reveals).
- **Assets live inside the deck.** Images, demos, notebooks, and video files are
  stored as bytes in the `.eigendeck` file; elements point at them by `assetId`.
  This keeps a deck a single, portable, offline file.
- **Math is `$...$` / `$$...$$` LaTeX**, rendered with a math font matched to the
  slide's text font. In hand-written JSON, escape backslashes (`\\lambda`) and
  the `<`/`>` inside math (`\\lt` / `\\gt`).

## The element types at a glance

Every element carries `id`, `type`, and `position`. Beyond that:

| Type | What it is | Reach for it when… |
|------|-----------|--------------------|
| `text` | Rich text with **5 presets** — `title`, `body`, `textbox`, `annotation`, `footnote` — each with its own default size/weight/color. Supports inline HTML and `$…$` math. | Any prose, headings, bullets, captions, equations in flowing text. **The default.** |
| `image` | A raster / SVG / PDF picture, stored as an asset. | Diagrams, photos, screenshots, or a pre-rendered equation SVG. |
| `arrow` | An SVG line/curve with arrowheads, in slide coordinates. | Pointing at things, connecting boxes, annotating. |
| `cover` | A plain rectangle mask (matches the slide background by default). | Hiding elements to reveal them later across a build group. |
| `notebook` | A live, scrollable Jupyter / IPython notebook (external kernel or in-app Pyodide). | Runnable code that executes during the talk. |
| `video` | A local video file (asset) or a YouTube / Vimeo / PeerTube embed. | Playing a clip or a screen recording. |
| `demo` | A self-contained interactive **HTML+JavaScript** demo that runs live in a sandboxed frame. | D3 / Canvas / WebGL widgets you drive during the talk. |
| `demo-piece` | One viewport of a multi-piece demo (several views of one simulation, side by side). | Splitting a demo into independently placed panels. |
| `html` | The raw-HTML **escape hatch** — arbitrary static markup in a locked, script-less, offline sandbox. | Custom design/layout no other type expresses (gradients, grids, fancy tables). |

Slides carry optional **theme** and **font** overrides (`titleFont` / `bodyFont`
/ `hypeFont`); anything a slide doesn't set cascades from the deck `config`.

## Where to go next (routing)

This skill is the map. For the actual work, hand off:

| If the user wants to… | Use skill |
|-----------------------|-----------|
| **Build / inspect / edit a deck headless** — generate a `.eigendeck` from JSON, add or bulk-edit slides and elements, embed image/demo assets, script a font/theme matrix or a fixture, all from the command line without opening the app | **eigendeck-cli** |
| **Author interactive JavaScript demos** — the `demo` element: live D3 / Canvas / WebGL widgets, the self-contained-HTML demo contract, multi-piece controller/viewport demos | **eigendeck-demo** |
| **Use the raw-HTML element** — the sandboxed, script-less, offline `html` escape hatch for custom design/layout markup | **eigendeck-html-element** |
| **Build bold "designer" full-bleed slides** — striking gradient/design slides authored as full-bleed HTML at 1920×1080, or porting a reveal.js / Slidev / frontend-slides deck into Eigendeck | **frontend-slides-eigendeck** |

Rough rule of thumb: **`eigendeck-cli` is the *how* (get the deck built/edited
at rest); the others are the *what* (which kind of element/content).** Most
non-trivial authoring is "use `eigendeck-cli` to write a deck whose slides
contain elements shaped by one of the other three skills."

## How to get the CLI

The `eigendeck-cli` binary **ships inside the app** — you don't build it. To get
a copy plus its reference docs, in Eigendeck choose **File → Install LLM Tools**
and pick a folder. That writes an `eigendeck-llm-tools/` kit there, containing an
`AGENTS.md` with the **absolute path to the installed `eigendeck-cli`** on that
machine, alongside the editing reference. After that, invoke it as:

```bash
eigendeck-cli <deck.eigendeck> <verb>      # e.g. outline, list slides, import json …
```

(The **eigendeck-cli** skill covers the verbs and the build-from-JSON workflow in
full. If the binary isn't on PATH, use the absolute path from the kit's
`AGENTS.md`.)

## Working principles

- **A deck is a single file.** It's SQLite — treat it as one unit; the app owns
  reading and writing it. To edit at rest, go through `eigendeck-cli`, not raw
  SQL.
- **Build decks with `eigendeck-cli import json`, then re-open to verify.** The
  JSON round-trip is the reliable way to construct or repair a deck in one shot.
  After building, inspect it (`eigendeck-cli <deck> info` / `outline`) rather
  than trusting a live editor view — "looks right on screen" is not "written to
  the file."
- **Assets travel with the deck.** When you author images or demos in JSON, the
  bytes must be embedded (as an assets array) and referenced by `assetId`, or the
  element renders blank. The **eigendeck-cli** skill has the exact recipe.
- **Presets over overrides.** For text, lean on the 5 presets; only set explicit
  `fontSize` / `color` when the user actually asks for it.

Start here, then route. The deep detail lives in the sibling skills above.
