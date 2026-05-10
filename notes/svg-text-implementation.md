# SVG-text Element — Implementation Notes

Branch: `svg-text-experiment` (off `multiple-fonts`)

## What it is

A new element type `svg-text` that renders text as `<svg><foreignObject>`
containing a styled HTML div, instead of a plain HTML div like the existing
`text` element.

The motivation: per-preset MathJax bundles. The MathJax singleton constraint
prevents two different math fonts on the same page. Wrapping each text
element in its own SVG (eventually with its own MathJax iframe) lets each
element use its own font/math bundle independently.

## Editing model

- Display = SVG (foreignObject containing styled HTML)
- Edit = plain contentEditable HTML (same styles, same dimensions)
- Double-click → enter edit
- Click outside / Esc / blur → commit + return to SVG

## Render structure

```
<svg viewBox="0 0 W H" preserveAspectRatio="none" width="W" height="H">
  <foreignObject x="0" y="0" width="W" height="H">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="width:Wpx;height:Hpx;<valign>;overflow:hidden;box-sizing:border-box;">
      <div style="width:100%;font-family:...;font-size:Xpx;...padding:8px 12px;">
        {{ inner HTML }}
      </div>
    </div>
  </foreignObject>
</svg>
```

## Bugs hit and fixes

### 1. React renders foreignObject children in SVG namespace

**Symptom**: `<div>` inside `<foreignObject>` rendered in SVG context, no HTML
content visible. Just showed nothing styled.

**Cause**: When React traverses an SVG subtree, it puts all child elements in
the SVG namespace. Even `<div>` becomes an SVG-namespaced div, which doesn't
display HTML. `dangerouslySetInnerHTML` on a child of the foreignObject also
fails because that child is SVG-namespaced.

**Fix**: Build the entire SVG markup as a string and inject via
`dangerouslySetInnerHTML` on a wrapper HTML div. The browser's HTML parser
then handles the SVG/HTML namespace switching at `<foreignObject>` correctly.

```tsx
return (
  <div ref={wrapperRef} dangerouslySetInnerHTML={{ __html: svgMarkup }} />
);
```

### 2. Edits reverted on click-out

**Symptom**: Type into the contentEditable, click anywhere outside the
element, the typed text vanishes and old text re-appears.

**Cause A** (commit ordering): `setEditing(false)` was called before reading
`ref.current.innerHTML`. React unmounted the contentEditable mid-call and the
ref went null.

**Fix A**: Read innerHTML first, then call `setEditing(false)`.

**Cause B** (re-render wipes DOM): Used `dangerouslySetInnerHTML={{ __html: element.html }}`
on the contentEditable. Every re-render re-applied this, wiping the user's
in-DOM edits if anything triggered a re-render mid-edit (and many things do —
selection changes, store subscriber updates, etc.).

**Fix B**: Set innerHTML once via `useEffect` on entering edit mode. Don't
use `dangerouslySetInnerHTML` in the render tree. Let the contentEditable
own the DOM thereafter.

```tsx
useEffect(() => {
  if (editing && ref.current) {
    ref.current.innerHTML = element.html;
    ref.current.focus();
    // ... move cursor to end ...
  }
}, [editing]);
```

### 3. Click on slide canvas didn't blur

**Symptom**: Click outside the element on the slide canvas — cursor still
blinks in the editable area, no commit.

**Cause**: The slide canvas isn't focusable (no tabindex), so clicking it
doesn't move focus away from the contentEditable. `onBlur` never fires.

**Fix**: Global `pointerdown` listener (capture phase) that commits when
the click target is outside the editable element.

```tsx
useEffect(() => {
  if (!editing) return;
  const onDocPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (ref.current && (target === ref.current || ref.current.contains(target))) return;
    stopEditing();
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);
  return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
}, [editing]);
```

### 4. Subpixel size drift

**Symptom**: SVG-rendered version was 1-2 pixels smaller than the contentEditable
version. Text "shrunk up and to the left" when leaving edit mode.

**Cause**: `<svg width="100%" height="100%">` lets the browser compute the
actual rendered pixel size, which after the slide-canvas `transform: scale()`
can land on a fractional value and round inconsistently. The viewBox-to-pixel
mapping then introduces 1-2 actual pixels of inset.

**Fix**: Use explicit pixel dimensions on the SVG matching the viewBox:
`<svg viewBox="0 0 W H" width="W" height="H">`. Combined with
`preserveAspectRatio="none"`, this pins the SVG canvas to exact viewBox units
and the foreignObject content lays out at integer pixel boundaries.

## Insights

1. **Browser-driven layout still works inside foreignObject.** Word wrap,
   flex centering, padding — all behave like a normal HTML div. So we get
   the editor-quality layout for free, in a self-contained SVG.

2. **Don't fight React's SVG namespace.** If you need HTML inside SVG,
   build the markup as a string and inject via `dangerouslySetInnerHTML`
   on an outer HTML wrapper.

3. **Commit-on-blur is unreliable when click targets aren't focusable.**
   Always pair with a document-level pointerdown capture listener.

4. **Subpixel rendering matters when there's a transform: scale() in the
   ancestor chain.** Use explicit pixel dimensions, not percentages.

5. **The structure mirroring trick:** to get edit and display to look
   identical, the OUTER wrapper structure has to be byte-identical
   (same width/height, same overflow, same box-sizing). Not just the
   inner styled element.

## What's next

Math support. The whole point of this experiment is to enable per-preset
MathJax bundles via iframe-isolated renderers (each iframe loads one bundle,
returns SVG via postMessage). With the SVG element as the host, math output
just gets composited into the same SVG.

## Math via iframe pool — bugs hit and fixes

### 5. SRE blob-Worker hang in non-PT bundles

**Symptom**: `tex2svgPromise` called inside the iframe returns a Promise
that never resolves or rejects. Internal 4s timeout fires every render.
Also affects the non-PT bundles when called from the main page (not just
in iframes).

**Cause**: The mathjax-fonts repo ships SRE-included bundles
(`tex-mml-svg-mathjax-<id>.js`). On startup, SRE loads via a blob:
URL Worker. Tauri's WebKit blocks blob: URLs, and our existing Worker
stub returns empty data. SRE then waits indefinitely for properly-formed
responses, blocking the entire MathJax startup pipeline.

Setting `options: { enableExplorer: false, ... }` only prevents *using*
SRE features — the modules are still `require()`-d at the top of the
bundle file and load synchronously.

**Fix**: build the `-nosre` variants (which omit `a11y/sre`, `a11y/explorer`,
`a11y/menu` etc. entirely). The mathjax-fonts repo has webpack configs
(`webpack-nosre.config.cjs`) for each but doesn't ship pre-built outputs.
Built via `mathjax-fonts/mathjax-shantell/build/build-all-nosre.cjs` which
calls webpack programmatically (the CLI prompts for "which CLI?" and
hangs in non-interactive mode).

### 6. Iframe loaded the wrong bundle file

**Symptom**: After switching the registry's `mathjaxBundle` filenames to
`-nosre`, the iframes still hung. Console warnings referenced the
non-nosre files.

**Cause**: The iframe page constructed its bundle URL from the `bundle`
id parameter alone: `'/mathjax/tex-mml-svg-mathjax-' + bundle + '.js'`.
The registry's filename change had no effect because the iframe ignored it.

**Fix**: Pass the full filename via a `?file=` URL parameter from the
broker (`pkg.mathjaxBundle`) and have the iframe load exactly that.

### 7. fontCache:'global' broke cross-document SVG transplant

**Symptom**: Math rendering succeeded (the broker received SVG markup),
but the SVGs were invisible when injected into the parent page's
foreignObject.

**Cause**: `svg.fontCache: 'global'` makes MathJax store glyph paths in
a single `<defs>` section in the rendering document. Each rendered
`<svg>` references those defs by id. When we extracted just the inner
`<svg>` and injected it into a different document, the id references
couldn't resolve — SVGs rendered as blank space.

**Fix**: `svg.fontCache: 'none'` inlines all glyph paths in every
rendered `<svg>`. Each output is fully self-contained and can be moved
across documents. Slightly larger output but the right trade for our use case.

### 8. Missing `{...}` wrapping rendered only first sub-expression

**Symptom**: `\alpha + \beta = \gamma` rendered as just `α`. Some
bundles only.

**Cause**: Documented in CLAUDE.md — without surrounding braces,
MathJax may parse only the first sub-expression. Different bundles
behave differently.

**Fix**: Always wrap as `'{' + tex + '}'` before passing to
`tex2svgPromise`. Same as the existing `src/lib/mathjax.ts`.

### 9. Italic-glyph ink overflow at right edge (open)

**Symptom**: `\gamma`, `\beta`, integrals etc. occasionally clip on the
right edge of the element.

**Cause**: MathJax's SVG `width` attribute is the typographic bounding
box. Italic glyphs have ink that extends past this for kerning purposes.
Our `overflow: hidden` on the inner foreignObject div clips the overhang.

**Status**: Not yet fixed. Options: remove overflow:hidden (math
overhangs the element bounds), add right padding, or pre-expand the
SVG viewBox in the broker.
