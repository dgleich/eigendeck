# Custom fonts in the `html` element (data: URIs)

The iframe CSP is `font-src data:` — remote fonts (Google/Fontshare `@import`/`<link>`)
are blocked and Eigendeck's own bundled fonts aren't reachable from inside the frame
either. Two ways to get type that isn't a system stack:

1. **System stacks** (zero cost, ship-in-10-years) — usually enough. See `patterns.md`.
2. **Embed the font as a `data:` URI** — the only way to use a *specific* face inside
   the element.

## Recipe

Get a `.woff2` for a font you're licensed to embed (SIL OFL fonts — e.g. most Google
Fonts — are fine). **Subset it first** — a full face is 50–150 KB (→ ~70–200 KB
base64 in every slide that uses it); a subset to the glyphs you actually show is a few
KB. Then base64-encode and inline it:

```bash
# subset to just the characters you use (needs fonttools: `uv tool install fonttools` / pip)
pyftsubset Font.woff2 --text="Your headline text 0123456789%×" \
  --flavor=woff2 --output-file=Font.subset.woff2
base64 -w0 Font.subset.woff2 > Font.b64          # one line, no wraps
```

Then in the slide's `<style>`:

```css
@font-face{
  font-family:'Deck Display';
  font-style:normal; font-weight:700; font-display:block;
  src:url(data:font/woff2;base64,<PASTE Font.b64>) format('woff2');
}
h1{font-family:'Deck Display',system-ui,sans-serif}
```

## Guidance

- **Subset per role, not per deck.** A display face only needs the ~40 glyphs in the
  headlines; body text needs a wider set (keep it a system stack unless the brand
  demands otherwise). Weigh KB-per-slide: the base64 is duplicated in every `html`
  element that declares the `@font-face` (iframes don't share styles).
- **`font-display:block`** avoids a flash of the fallback while the (instant, local)
  data: font decodes.
- **Verify it actually took**: render the slide via the e2e rig and check
  `getComputedStyle(headline).fontFamily` resolves to your family, not the fallback.
  A blocked/typo'd `@font-face` silently falls through the stack.
- A builder script should read the `.b64` file at build time and interpolate it, so
  the giant string stays out of the source (see how `tools/build_*` inline assets).
- Only embed fonts you're licensed to redistribute (OFL/Apache are safe; many
  commercial faces are not).
