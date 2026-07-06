# Building demos with LLMs

The interactive pieces in a talk — a force-directed graph you can drag, a
Schrödinger simulation with a field-strength slider, a molecule viewer — are
usually one-off visualizations. Writing each by hand is slow. An LLM (Claude,
etc.) can produce a working one in a single session, and Eigendeck is built to
drop that result straight onto a slide.

Every interactive demo in the built-in **Welcome to Eigendeck** deck was made
this way.

## The shape of an Eigendeck demo

A demo is a **single self-contained HTML file**. It runs in a sandboxed iframe
over the slide — isolated, so it can't touch the app or your files — and can be
split into *pieces* — separate viewports (a plot, a control panel, an info box)
that you position independently on the slide and that talk to each other over
`BroadcastChannel`. Eigendeck scans the HTML for the
piece names you reference and creates a positionable element for each.

The full contract — the file template, the controller/piece/standalone roles,
how export works, and the rules that keep a demo robust — is in
**[`DEMO_AUTHORING.md`](../../DEMO_AUTHORING.md)** at the repo root. That file is
also what you hand an LLM: it's installable from the app via **File → Install LLM
Tools…**, which drops the authoring guide and a starter demo where an
LLM/agent working in your project can read them.

## Two things that make a demo silently fail

Both are enforced, and both show up as a *blank* demo rather than an error, so
they're worth knowing up front (the full rules are in `DEMO_AUTHORING.md`):

- **The marker.** A demo must begin with `<!--eigendeck-demo-v1-->` right after
  `<!DOCTYPE html>`, or Eigendeck won't recognize the file as a demo and won't
  mount it. (The starter file and the LLM guide already include it — keep it.)
- **The internet is off by default.** A demo can't reach the network unless it
  **declares the hosts it needs** in a small JSON manifest in its `<head>`. So if
  your demo loads a library from a CDN (D3, Plotly, topojson…) or fetches data,
  you must list that host, e.g.:

  ```html
  <script type="application/eigendeck-manifest+json">
  { "network": [ { "host": "d3js.org", "purpose": "D3 visualization library" } ] }
  </script>
  ```

  Without it the CDN `<script>`/`fetch` is blocked and the demo renders blank.
  Declaring a host also shows it (with its purpose) in the deck's Security →
  Internet panel, where the viewer can allow or block it. Prefer inlining a
  library when you can — a self-contained demo works even when internet is off.
  See the "Internet access" section of `DEMO_AUTHORING.md` for the exact rules
  (valid host formats, per-deck / global switches).

## A workflow that works

1. **Describe the demo to the LLM**, and point it at `DEMO_AUTHORING.md` (or run
   *Install LLM Tools…* first so it's in the project). Ask for a single HTML
   file following that guide — including the piece names you want as separate
   slide elements.
2. **Save the HTML** the LLM produces.
3. **Add it to a slide**: Insert → Demo (HTML)…, pick the file. Eigendeck reads
   the `piece === '…'` checks and creates one element per piece; arrange them on
   the slide.
4. **Iterate.** The file is *watched* — edit it (or have the LLM revise it) and
   the slide reloads. See [watched assets](assets.md).

## Make demos match the deck

Two rules let a demo blend into your slides automatically:

- **Don't paint a background** — a demo iframe is transparent, so the slide's
  background shows through and the demo matches every theme for free.
- **Use the injected theme variables** for any text/controls: `var(--eigendeck-fg)`,
  `--eigendeck-bg`, `--eigendeck-accent`, `--eigendeck-font`, etc. Eigendeck
  splices the deck's resolved fonts + colors into every demo at mount; if you
  change the theme, the demo re-mounts with the new values. Control labels and
  canvas text should use these vars so they stay legible on light *and* dark
  slides.

Both are covered in detail (with a worked example) in the "Matching the deck"
section of [`DEMO_AUTHORING.md`](../../DEMO_AUTHORING.md).

## Configurable demos

If you want one demo file to show different content on different slides, read a
parameter from the URL hash or use the piece name — see the `gimmicks` example in
`example-demos/` for a tiny demo whose displayed word is configurable.
