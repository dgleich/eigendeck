// Per-type element DESCRIPTOR — the single place that knows what each element
// TYPE is (its box + resolved visual values + content spec), independent of HOW
// it's painted. Per-target ADAPTERS consume a descriptor and specialize the
// emit form (React node / HTML string), the wrapper (editor DraggableBox /
// bare / absolute div), and how heavy types degrade (live iframe / cached
// preview / placeholder).
//
// Goal: ONE rendering path with specializations, not k parallel switches — so a
// new element type or a render tweak happens in one place and can't drift across
// the editor / present / thumbnail / HTML-export / print targets.
//
// Pure + `.mjs` (no TS, no React) so BOTH the HTML export (exportCore.mjs, shared
// with the CLI) and the React renderers can import it. The resolved slide
// background is passed IN, because each target obtains it differently (editor:
// a prop; others: resolveTheme()/themeBackground()).
//
// Migration: types are moved onto this path incrementally (cover, image, arrow).

import { arrowGeometry } from './arrowGeometry.mjs';

/** cover — a reveal mask filled with the slide background; an explicit color wins. */
export function describeCover(el, resolvedSlideBg) {
  return { kind: 'cover', box: el.position, background: el.color || resolvedSlideBg };
}

/**
 * image visual styles — the optional shadow / corner-radius / opacity / rotation
 * an image carries. The single source of the four predicates + the magic shadow
 * string; each target maps the present values into its own form (a React style
 * object via imageVisualStyle, or CSS-string fragments in the HTML export).
 * Absent props are `undefined` so adapters skip them. `borderRadius` stays a raw
 * px number; `transform` is the ready-to-use CSS `rotate(...)` value.
 */
export function imageVisuals(el) {
  return {
    shadow: el.shadow ? 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))' : undefined,
    borderRadius: el.borderRadius || undefined,
    opacity: (el.opacity != null && el.opacity < 1) ? el.opacity : undefined,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

/**
 * arrow — endpoints + resolved style + computed geometry. Owns the ONE canonical
 * default (matching SlideEditor's creation defaults: #2563eb, strokeWidth 4,
 * headSize 16) so a color-omitted arrow can't render differently per target —
 * closes the latent #105 divergence where app paths defaulted red (#e53e3e) and
 * export paths blue (#2563eb). Geometry (inset line + head triangles) is computed
 * once here; each target renders geo/color/strokeWidth/opacity its own way (React
 * ArrowGlyph, the SVG-string arrowSvgInner, or LinkOverlay's hit-target).
 */
export function describeArrow(el) {
  const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16, heads, opacity } = el;
  return {
    kind: 'arrow', x1, y1, x2, y2, color, strokeWidth, headSize, heads, opacity,
    geo: arrowGeometry(x1, y1, x2, y2, headSize, heads),
  };
}
