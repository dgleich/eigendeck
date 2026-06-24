# Styles and fonts

Eigendeck ships a curated set of fonts — and the thing that makes it good for
technical talks is that **each text font is paired with a matching math font**.
When you set a slide in Computer Modern Concrete, the equations render in Euler
to match; set it in Shantell Sans and the math looks hand-drawn too.

## Fonts

Ten text-font families, each with a matching MathJax math pack:

> PT Sans · Lato · Libertinus · Libertinus Sans · Computer Modern Sans ·
> Noto Sans · Source Sans 3 · Source Code Pro · Shantell Sans · Computer Modern
> Concrete

plus monospace **code fonts** (no math): Fira Code, IBM Plex Mono, Inconsolata,
JetBrains Mono, PT Mono, Computer Modern Typewriter.

**Setting fonts.** The deck has a default font (Presentation properties); any
slide can override it (Slide inspector → Body / Title font). The
**Welcome** deck's slides 14–18 are the same content in four different fonts to
show this off — build the slide once, duplicate, and change the font + theme on
each copy.

## Math (MathJax)

Type LaTeX inline with `$…$` (or `$$…$$` for display). It renders as SVG in the
slide's font. Because the math font tracks the text font, an equation always
looks like it belongs on the slide.

**Macros.** Define reusable macros once for the whole deck (Presentation
properties → math preamble) — e.g. `\mA` for a bold **A**, `\vp` for a vector
*p*. Then use them anywhere math appears. The Welcome deck does this heavily.

## Themes

A **theme** sets the slide's background and the default text/accent colors.
Built-in themes: **white**, **light**, **dark**, **black**. Set the deck default
in Presentation properties, override per slide in the Slide inspector. Demos and
covers pick up the resolved theme automatically.

## Text styling

Per-element styling lives in the inspector when a text element is selected:

- **Text color** and **background color** (a panel behind the text), each with
  a palette + custom picker.
- **Vertical alignment**, **opacity**, **rotation**.
- **Text effects** — shadow / glow — for legibility over busy backgrounds.
- The format toolbar (bold/italic/etc.) for inline runs.

See also [text sizes](text-sizes.md) for the named type scale (footnote / note /
body / title / hype) and how to change it deck-wide.
