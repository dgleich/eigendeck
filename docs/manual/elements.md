# Elements

Every slide is a stack of **elements** you place on the canvas (their order is
the z-order). Insert any of them from the **Insert** menu or the toolbar. This
page is the quick tour; deeper topics link out.

## Text elements

Text comes in **presets** — each is a starting style (size, weight, role), not a
cage; you can restyle any of them per element.

| Preset | Role | Default size |
|---|---|---|
| **Title** | slide titles | 72 px |
| **Body** | main content | 48 px |
| **Text Box** | free-floating text | 48 px |
| **Note** | smaller secondary text | 32 px |
| **Footnote** | fine print, sources | 24 px |
| **Hype** | a tilted yellow sticky note | 48 px |

All text supports **inline LaTeX** with `$…$`, the format toolbar (bold/italic/…),
and per-element colour, background panel, alignment, opacity, rotation, and
shadow/glow effects. The sizes come from one deck-wide [type scale](text-sizes.md);
fonts and math are covered in [styles and fonts](styles-and-fonts.md).

> **One size per text element.** You can't mix font sizes *within* a single text
> element — the size is a property of the whole element (set by its preset, or
> overridden in the inspector). This is deliberate: it keeps the text inside an
> element visually harmonious. When you want a different size, use a separate
> element with the appropriate preset (e.g. a Title above a Body, a Footnote
> below). See [text sizes](text-sizes.md).

### Annotation elements

The **Note** preset doubles as the annotation: smaller, italic, accent-coloured
by default — for the "move the slider →" style callouts you point at things with.
Pair it with an **Arrow** (below). See slides 9 and 19 of the
[Welcome walkthrough](building-a-presentation.md).

## Image elements

Raster (PNG/JPEG/WebP/GIF), **SVG**, and **PDF** — PDFs and SVGs are rasterized
on demand and re-rendered crisply at any size. Images are embedded in the deck
*and* watched on disk, so you can keep editing the source file. Options: shadow,
rounded corners, opacity, rotation. See [watched assets](assets.md).

## Arrow elements

A straight arrow with adjustable colour, stroke width, and head size — for
pointing an annotation at the thing it describes.

## Cover elements

A rectangle that **defaults to the slide background colour**, so it's an
invisible mask — drop it over content you'll reveal on a later build slide, then
remove it. You can also tint a cover any colour from the inspector (Color →
*Match* keeps it invisible). Great with [build slides](building-a-presentation.md#2-the-argument-with-build-slides-and-reveal-masks).

## Interactive elements

The heart of an interactive show-and-tell.

- **Demos** — self-contained HTML, often split into multiple **pieces** (a plot,
  a control panel, an info box) you position separately; they talk over
  `BroadcastChannel`. Transparent over the slide and theme-aware. Make them in an
  LLM session — see [Building demos with LLMs](building-demos-with-llms.md).
- **Notebooks** — real Jupyter notebooks on a slide, scrollable and editable
  *during* the talk (view-only in exported HTML). The deck records outputs
  without touching your source `.ipynb`. See [notebooks](notebooks.md) and
  [Jupyter servers](notebook-servers.md).
- **Videos** — local files (embedded + watched) or YouTube/Vimeo/PeerTube
  embeds, with loop/ping-pong/speed/autoplay/captions options. See
  [videos](videos.md).

## Relating elements across slides

Two ways to connect an element to its counterpart on another slide:

- **Sync** — the *same* element shown on several slides (shared position/content).
- **Link** — two *separate* elements linked so the presenter animates between
  them.

Both come from duplicating a slide; see [sync and link](sync-and-link.md).
