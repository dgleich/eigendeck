# Eigendeck TikZ/PGF Renderer — Plan

**Date:** 2026-06-03
**Status:** Design/feasibility — not yet building
**Related:** [beamer-import-design.md](beamer-import-design.md) (the
Beamer importer is one consumer; this replaces its "TikZ dropped with a
warning" non-goal)

## What this is

A **custom build of TikZJax for eigendeck** that renders TikZ/PGF
figures using **eigendeck's own MathJax font packages** (currently
**Lete Sans Math + PT Sans**) for all text and math — so figures match
the deck's typography instead of TeX's default Computer Modern.

It combines two pieces:
- **TikZJax** (WASM TeX) — **a new component we adopt and fork.**
  Eigendeck does **not** use it today; this project brings it in and
  builds a customized version. Does the geometry and graphics.
- **The eigendeck MathJax bundles** (`mathjax-ptsans-bundle` + the
  per-bundle math fonts) — **already shipped and in use.** Do the
  text/math rendering.

Motivated by the Beamer importer (`tikzpicture` → figure), but it's a
**standalone, reusable eigendeck capability** — the same renderer can
back in-app TikZ authoring later. Because it always uses the *live*
MathJax bundle, it's **robust to font/bundle changes** with zero
per-bundle work.

## Core challenge (the whole problem in one paragraph)

TikZ sizes nodes and resolves anchors / `fit` / matrix & tree spacing
from the **dimensions of each typeset label box** (width/height/depth).
So to render labels in eigendeck's MathJax fonts, TeX must run its
layout using **MathJax-derived metrics**, not its native TFM metrics.
Getting MathJax's box metrics into TikZ's layout *is* the project.
Everything else is straightforward: graphics → SVG via `dvisvgm`, and
text → SVG via MathJax.

## The two approaches (the decision)

### Approach 1 — Render twice (measure pass, then metrics-injected pass)

1. **Render once** with TikZJax to discover the label strings — capture
   each text node's *fully-expanded* content (TeX has already resolved
   `\foreach`, counters, macros).
2. **Measure** those strings with eigendeck MathJax → dimensions
   (w/h/depth, baseline/valign).
3. **Render again**, injecting our MathJax metrics so TeX lays out every
   node to the MathJax size; composite the MathJax-rendered text into the
   output at the TikZ positions.

- **Pros:** buildable by **orchestrating TikZJax from JS** plus a
  macro-level text hook — little or no engine-internals surgery. Uses
  stock-ish TikZJax, run twice.
- **Cons:** 2× render; must **match** pass-1 strings to pass-2 injection
  sites (occurrence-index keying). Fragile only if a picture's control
  flow depends on typeset dimensions in a way that changes the
  number/order of labels — rare.

### Approach 2 — MathJax in the render loop (direct bound sensing)

Integrate MathJax measurement into TikZJax's **single render**: at each
text node, MathJax renders/measures the content inline and its bounding
box is fed **directly** into TikZ's node-dimension mechanism ("direct
bound sensing"). One pass.

- **Pros:** single pass; exact metrics with no string-matching/keying;
  cleanest result; the natural foundation for live in-app authoring.
- **Cons:** a genuinely **custom TikZJax build** — deeper integration
  into the engine/render loop. Both TikZJax and MathJax are JS in one
  process, so a synchronous MathJax call mid-render is feasible, but
  this is real surgery in the WASM/TeX integration, not just
  orchestration.

**Axis to decide on:** Approach 1 trades a 2× render + keying for *much*
less engineering (no engine fork); Approach 2 is the cleaner, exact,
one-pass end state but requires modifying the TikZJax internals. 1 is
the faster prototype; 2 is the better permanent home (esp. if we ever
author TikZ live in eigendeck).

## Output & compositing (both approaches)

- **Graphics:** TikZJax → `dvisvgm` → SVG paths.
- **Text/math:** eigendeck MathJax → SVG, placed at the TikZ-computed
  positions, carrying each node's transform (rotation/scale).
- **Final:** one composited SVG figure → eigendeck `image` element
  (`kind:'svg'`), rasterized on demand like any other SVG asset.

## Verification

Fixture snippets exercising the metric coupling — a static label, a
`\foreach`-indexed set (`$q_\i$`), a `pgfplots` numeric-tick axis, a
rotated node, a tightly-fitted circle node, and a `fit` box — each
rendered and **asserted** so the node geometry matches the MathJax label
box (no overflow, baseline aligned). Dimension diffs, not eyeballing.
This is cheap and decisive, and the same harness validates either
approach.

## Relation to the Beamer importer

Replaces the importer's "TikZ dropped with a warning" non-goal. The rest
of the importer does **not** depend on this — `tikzpicture` can
drop-with-report first, and gain this renderer as an upgrade once we
pick Approach 1 or 2. See `beamer-import-design.md`.
