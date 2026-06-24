# Philosophy: show *and* tell

Eigendeck exists to build **interactive show-and-tell sessions** — talks where
you don't just describe an idea, you *demonstrate* it live, in front of the
audience, and can poke at it as questions come up.

## Show, don't (only) tell

Film has a rule: *show, don't tell*. It doesn't quite work for scientific talks —
we genuinely need to tell: define the notation, state the theorem, walk the
argument. So the goal isn't to replace telling. It's to **show as well**.

A traditional slide deck inherits its shape from the 1960s slide projector: a
fixed sequence of static images. That was the only option when the "computer"
was a carousel of photographic slides. But the machine in front of you can run a
simulation, lay out a graph, evaluate a model, and respond to a slider — *during*
the talk. Eigendeck is built around that: a slide can hold a live, interactive
demo right next to the math that explains it.

The result is a talk where you can say "and if we increase the field strength…"
and then actually drag the slider and let the audience watch what happens.

## What this means in practice

A few beliefs shape how the tool works:

- **A slide is a stage, not a snapshot.** Slides hold live elements — demos,
  notebooks, videos — alongside text and math, not just pictures of them.
- **The technical content is first-class.** Real LaTeX via MathJax, a curated set
  of fonts each paired with a matching math font, so an equation on a Shantell
  slide looks like it belongs there.
- **Authoring should be direct.** WYSIWYG on a canvas: drag things where you want
  them, type math inline, drop in an image or a Jupyter notebook.
- **The demos come from anywhere — including LLMs.** Many of the interactive
  pieces in a modern talk are quick one-off visualizations. Building those by
hand is slow; building them with an LLM is fast. Eigendeck embeds plain HTML
  demos, so an LLM session is a perfectly good way to produce one. See
  [Building demos with LLMs](building-demos-with-llms.md).
- **Your deck stays yours.** Decks are self-contained files; assets you add are
  embedded *and* live-watched on disk, so you can keep editing the source.

## Where to go next

- [Building a presentation](building-a-presentation.md) — a slide-by-slide
  walkthrough of the built-in **Welcome to Eigendeck** deck, showing how each
  slide was constructed.
- [Building demos with LLMs](building-demos-with-llms.md) — how to produce the
  interactive pieces.
- The [elements & features reference](README.md#elements--features) — the
  building blocks (text, annotations, interactive elements, styles & fonts,
  watched assets, …).
