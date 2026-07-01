# Eigendeck manual

A user-facing guide to building talks in Eigendeck. Start with the philosophy,
then build your first deck, then dig into individual elements and features.

> Different from `DESIGN_DECISIONS.md` and the other top-level `*.md` docs —
> those explain implementation choices to people reading the code. The manual
> explains *editorial* choices to people building presentations.

## Start here

- **[Philosophy](philosophy.md)** — what Eigendeck is *for*: building interactive
  show-and-tell sessions where you demonstrate ideas live, not just describe them.
- **[Building a presentation](building-a-presentation.md)** — a slide-by-slide
  walkthrough of the built-in **Welcome to Eigendeck** deck, with screenshots,
  showing how each slide was constructed.
- **[Building demos with LLMs](building-demos-with-llms.md)** — how to produce the
  interactive pieces that make a talk show-and-tell.

## Elements & features

A run-through of the building blocks:

- **[Elements](elements.md)** — the full set: text presets (title / body /
  textbox / note / footnote / hype), annotations, images, arrows, covers, and the
  interactive elements (demos, notebooks, videos).
- **[Styles and fonts](styles-and-fonts.md)** — the ten font families (each with
  a matching math font), MathJax + macros, themes, and per-element text styling.
- **[Text sizes](text-sizes.md)** — the named type scale and why slide-level
  overrides don't exist.
- **[Interactive demos →](building-demos-with-llms.md)** — see the LLM guide above;
  the full authoring contract is [`DEMO_AUTHORING.md`](../../DEMO_AUTHORING.md).
- **[Notebooks](notebooks.md)** — embedding Jupyter notebooks, in-deck recording
  (your source file is never touched), editable vs. file-watching, display
  options, and syncing a notebook across slides.
- **[Jupyter servers](notebook-servers.md)** — the per-machine kernel-server
  registry, why deck files don't carry URLs or tokens, and the topbar status pill.
- **[Videos](videos.md)** — local video files (embedded + watched) vs.
  YouTube/Vimeo/PeerTube embeds, the playback options, and how thumbnails/export
  work.
- **[Watched assets](assets.md)** — how files you add are embedded *and*
  live-watched, the Watch cascade (global → deck → per-asset), "editable = take
  control" for notebooks, and Reload-from-disk.
- **[Security: your files stay yours](security.md)** — why decks you *receive* can
  show everything but can't read live files off your disk until you trust them, the
  Security Panel, and how the app respects your data and your time.
- **[Sync and link](sync-and-link.md)** — the two ways to relate elements across
  slides (sync unifies, link animates), the duplicate→free→move animation
  workflow, the S/A badges, promoting a link to a sync, and what copy/paste does.
- **[Cut, copy, and paste](clipboard.md)** — what paste does on the canvas vs.
  in a text box, pasting images/SVG/PDF, and pasting a spreadsheet/HTML selection
  as a deck-font picture.

(More topics are added as features land.)

## How to read this

Each topic page starts with the rule (what the tool does), then the reasoning
(why it does that), then the workflow (how to live with it well). If a topic
explains a constraint you find frustrating, read past the rule — the reasoning is
usually the point.
