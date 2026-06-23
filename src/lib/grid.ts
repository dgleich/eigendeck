// Pure helpers for the editor alignment grid (snap-to-grid).
//
// Kept free of any store/preference reads so the rounding is trivially
// unit-testable. The component layer (DraggableBox) supplies the live
// spacing + on/off + bypass state and calls snapToGrid().

/**
 * Round a slide-space coordinate to the nearest multiple of `spacing`.
 *
 * A spacing below 2px (or non-finite) is treated as "no grid" and returns
 * the value unchanged — guards against a 0/1px grid snapping everything to
 * the origin or to every pixel.
 */
export function snapToGrid(value: number, spacing: number): number {
  if (!Number.isFinite(spacing) || spacing < 2) return value;
  return Math.round(value / spacing) * spacing;
}

// Grid overlay marker color (light slate) — the coarse markers use the SAME light
// grey as the fine dots; they're distinguished by SHAPE (a small +), not weight.
const MARK = 'rgba(100,116,139,0.55)';

/**
 * Background CSS for the editor's alignment-grid overlay (#89): a FINE dot at
 * every grid point (0, g, 2g…) plus a small "+" CROSS every 4th cell, offset 2
 * cells in — so the crosses fall on the grid points at 2g, 6g, 10g… A coarse
 * reference that reads at a glance without darkening anything (same light grey).
 *
 * The WHOLE overlay is ONE inline-SVG tile (size = 4× spacing, with an explicit
 * viewBox): the fine dots AND the coarse cross share the same coordinate system,
 * so they can't drift apart across engines / Retina (mixing a radial-gradient
 * dot layer with an SVG cross layer misaligned them on WKWebView — #89). The
 * cross is drawn first and the center dot last, so the dot sits in the middle of
 * the "+". Pure → unit-tested.
 */
export function gridOverlayStyle(spacing: number): {
  backgroundImage: string; backgroundSize: string; backgroundPosition: string;
} {
  const g = spacing;
  const coarse = 4 * g;   // tile spans 4 cells; cross every 4th line
  const c = coarse / 2;   // = 2g — tile center → cross lands on grid points 2g,6g,…
  const a = 6;            // arm half-length (px) → a small ~13px cross
  const r = 1.5;          // fine-dot radius (px) — small; a crisp SVG disc reads
                          //   bolder than the old soft radial-gradient dot
  // Dots at every grid point in [0, 4g], INCLUDING the 0 and 4g edges so they
  // compose seamlessly with the neighbouring tiles' edge dots when repeated.
  let dots = '';
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    dots += `<circle cx='${i * g}' cy='${j * g}' r='${r}'/>`;
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${coarse} ${coarse}' ` +
    `width='${coarse}' height='${coarse}'>` +
    `<path d='M${c} ${c - a}V${c + a}M${c - a} ${c}H${c + a}' ` +
    `stroke='${MARK}' stroke-width='1' fill='none' shape-rendering='crispEdges'/>` +
    `<g fill='${MARK}'>${dots}</g>` +   // dots after the cross → center dot on top
    `</svg>`;
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: `${coarse}px ${coarse}px`,
    backgroundPosition: '0 0',
  };
}
