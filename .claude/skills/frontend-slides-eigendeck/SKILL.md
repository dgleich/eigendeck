---
name: frontend-slides-eigendeck
description: This skill should be used when the user wants a visually striking, "frontend-slides"-style presentation built IN Eigendeck using the raw-HTML element (#137) — bold gradient/design slides authored as full-bleed HTML at 1920×1080. Also use it to PORT a frontend-slides / reveal.js / Slidev HTML deck into Eigendeck, or whenever someone asks for "designer" slides that go beyond text + images. Encodes the design system PLUS the sandbox constraints (no JavaScript, no network — fonts and images must be system stacks or data: URIs; motion is CSS @keyframes; interactivity is native controls behind the `interactive` flag). Eigendeck already provides navigation, scaling, transitions, export, and speaker notes, so you author only each slide's HTML body, not a presentation framework.
---

# Frontend-Slides in Eigendeck

Build bold, self-contained, designer-grade slides in Eigendeck by putting one
full-bleed **`html` element** per slide. This is the [frontend-slides](https://github.com/zarazhangrui/frontend-slides)
aesthetic (single-file HTML, no framework) adapted to Eigendeck's **sandboxed,
script-less, offline** `html` element.

## Why this works so well

frontend-slides authors each slide at **1920×1080** as self-contained HTML — the
**exact canvas Eigendeck uses**. So one of its slides ≈ one Eigendeck `html`
element. And Eigendeck already *is* the presentation runtime that those skills
hand-roll in JavaScript:

| frontend-slides / reveal.js / Slidev does in JS | In Eigendeck |
|---|---|
| slide navigation (keys/wheel/touch) | native — arrow keys / clicker |
| stage scaling / letterbox to 1920×1080 | native — the deck scales the slide |
| transitions, fragments/step reveals | native — slide transitions + **Build** / linked-object animation |
| inline editing + autosave, single-file export | native — editor, autosave, HTML/PDF export |
| speaker notes | native — Speaker Notes + presenter view |

**So you author ONLY the slide body** (the `<div class="slide">…</div>` + its
`<style>`), never a `SlidePresentation` class. Drop it into an `html` element and
Eigendeck runs the deck.

## The one thing to internalize: the sandbox

The `html` element renders in a locked iframe — **no JavaScript, no network** (CSP
allows only `data:` URIs). Design within this from the start; don't fight it:

- **No `<script>`, no inline `onclick`/`onerror`.** Motion = CSS `@keyframes`.
  Interactivity = native controls (`<input type=range>`, radio/`:checked`,
  `<details>`, `:hover`) with `interactive: true` (see below). This is plenty —
  a whole thermometer, tabs, accordions, and reveal-on-hover work with zero JS.
- **No remote fonts** (`@import`/`<link>` to Google/Fontshare is CSP-blocked and
  silently falls back). Use a **system font stack**, or **embed a font as a
  `data:` URI** (`fonts.md`). Eigendeck's bundled fonts are NOT reachable from
  inside the iframe either (also blocked) — data: or system only.
- **No remote images.** Use inline `<svg>`, CSS gradients, or **`data:` URIs**.
  For a big photo, prefer a real Eigendeck `image` element layered behind/around
  the `html` element (it goes through the asset pipeline).
- Inline `<style>` and `style=` attributes are fine and scoped to the iframe.

`patterns.md` = copy-paste slide templates. `fonts.md` = the data:-font recipe.

## Element schema (what you're producing)

Each slide is normally ONE element filling the canvas:

```json
{ "id": "uuid", "type": "html",
  "position": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
  "background": "#0a0a0f",
  "html": "<style>…</style><div class=\"slide\">…</div>" }
```

- `background` optional (behind the HTML; default transparent). Set it to your
  slide bg so there's no flash before the iframe paints.
- Add `"interactive": true` ONLY for slides with clickable/hoverable controls —
  it lets the iframe receive mouse events (present mode + an editor "interact"
  mode). Leave it off for static design slides so they never block the slide.
- You MAY mix in native Eigendeck elements on the same slide (a `text` title in a
  bundled font over an `html` graphic, an `image` photo behind it). Use native
  `text` when you want the deck's real fonts / editing; use `html` for anything
  the other element types can't express.

See `docs/LLM-EDITING.md` (HTML Element) for the full field reference.

## Design system (frontend-slides "bold", at 1920×1080)

Author at native resolution — sizes are LARGE:

- **Type scale:** hero headline 120–170px, section title 90–120px, body 30–40px,
  kicker/eyebrow 24–30px (letter-spacing .2–.3em, uppercase). `line-height:.95`
  on big display type; `-.03em` letter-spacing tightens headlines.
- **Theme via CSS custom properties** on `:root` (`--bg`, `--accent`, `--accent2`,
  `--muted`) so a slide re-themes in one place. Keep a consistent palette deck-wide.
- **Depth:** layered `radial-gradient`/`conic-gradient` backgrounds, a big blurred
  gradient "aurora" (`filter:blur(120px)`), soft glows (`box-shadow` / `text-shadow`),
  `background-clip:text` gradient headlines.
- **Layout:** flexbox/grid, generous padding (100–140px). Content left-aligned or
  centered; asymmetric layouts read as "designed."
- **Motion:** staggered entrance (`@keyframes rise` with per-child `animation-delay`),
  `cubic-bezier(0.16,1,0.3,1)` easing, ~0.6–0.9s. A slow looping ambient animation
  (aurora spin, shimmer) adds life. (Note: CSS animations run when the slide's
  iframe mounts.)

`patterns.md` has ready templates: hero, section divider, stat grid, feature grid,
quote, comparison table, closing.

## Build + verify workflow

1. **Author a builder** (recommended) — a small Node script that emits the deck
   JSON with each slide's HTML as a readable template literal, so it's
   regenerable and diff-able. Model it on `tools/build_html_showcase.mjs` /
   `tools/build_frontend_slides_example.mjs`. Keep HTML self-contained (inline
   `<style>`, system/data: fonts, inline SVG / data: images).
   **Always include a top-level `config: { "width": 1920, "height": 1080 }`** in
   the deck JSON — Eigendeck defaults to it if missing, but a deck without it that
   hits an older build presents to a collapsed 0×0 stage (shows nothing).
2. **Build the deck** with the **eigendeck-cli** skill:
   `eigendeck-cli <deck>.eigendeck import json <deck>.json`.
3. **Render + eyeball EVERY slide** with the **eigendeck-e2e** rig — don't trust
   the JSON. Open the deck, `selectSlide(i)` via the `window.__eigendeck` seam,
   screenshot, and actually LOOK (Read the PNG). Fix anything clipped, off-canvas,
   or where a remote font/image silently dropped. (Template probe:
   `e2e/html-showcase-probe.mjs`.) Verify `getComputedStyle(headline).fontFamily`
   didn't fall through your stack if you intended a custom face.
4. **Commit the `.eigendeck`** via the **commit-presentations** skill (history +
   schema-compat gates) alongside the builder.

## Common pitfalls (all from the sandbox)

- **Headline looks like the wrong font** → a remote `@import`/`<link>` was blocked;
  it fell back. Switch to a system stack or embed via `data:` (`fonts.md`).
- **Missing image** → it was a remote/path `src`; inline it (`data:`/SVG) or use an
  Eigendeck `image` element.
- **"Interactive" widget doesn't respond** → set `"interactive": true`; in the
  editor double-click to enter interact mode.
- **Animation only plays once** → CSS animations run on iframe mount, not on each
  slide revisit. For deliberate step reveals, use Eigendeck's **Build** feature or
  linked-object animation across slides instead of JS fragments.
- **Content off-canvas** → you're authoring at 1920×1080; a `100vw/100vh` box maps
  to the element box. Keep the root at `height:100%` and size in px against 1920×1080.

## Do NOT

- …reach for `<script>`, remote fonts/CDNs, or file-path images — they won't work.
- …re-implement navigation/scaling/export in the slide — Eigendeck owns that.
- …ship without rendering every slide through the rig and looking at it.
