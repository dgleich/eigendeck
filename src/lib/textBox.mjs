// Inner-box layout (line spacing + padding) for a text preset's rendered HTML —
// the SINGLE SOURCE shared by the live editor / SVG render (TextElementSvg, via
// the types/presentation re-export) and the static HTML exports (exportCore.mjs
// for the CLI + printSlideHtml.ts for PDF). Pure `.mjs` so it crosses the
// .mjs/.ts boundary like themeColors.mjs / textSizes.mjs.
//
// Footnote renders TIGHT (lineHeight 1, no padding) so a one-line 24px footnote
// sits flush on the grid; every other preset gets the comfortable 1.3 line-height
// + 8/12px padding. The export paths previously hardcoded `line-height:1.3` and
// `8/12` padding, so they lost footnote-tightness and per-element padding
// overrides vs the editor — keeping one copy stops that WYSIWYG drift.

export function textPresetBoxCss(preset) {
  if (preset === 'footnote') return { lineHeight: 1, padY: 0, padX: 0 };
  return { lineHeight: 1.3, padY: 8, padX: 12 };
}

/** Effective inner padding as a CSS px shorthand ("8px 12px" or per-side), honoring
 *  the element's `padding` override else the preset default. */
export function textPaddingCss(el, preset) {
  const p = el && el.padding;
  if (p) return `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
  const box = textPresetBoxCss(preset);
  return `${box.padY}px ${box.padX}px`;
}
