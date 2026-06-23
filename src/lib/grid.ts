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

// A single "+" SVG path centered at (x,y) with arm half-length a.
const crossPath = (x: number, y: number, a: number) =>
  `M${x} ${y - a}V${y + a}M${x - a} ${y}H${x + a}`;

/**
 * Background CSS for the editor's alignment-grid overlay (#89). Three tiers of
 * marker, all in the SAME light grey — distinguished by SHAPE/WEIGHT, not colour:
 *
 *   1. a FINE dot at every grid point (0, g, 2g…);
 *   2. a thin "+" CROSS every 4th cell (offset 2 cells in → on the grid points
 *      2g, 6g, 10g…), a coarse reference that reads at a glance;
 *   3. on a FINE grid only (spacing < 30, e.g. 12/15/20/24, where the every-4th
 *      crosses get dense), a slightly THICKER "+" every 16th cell (every 4th
 *      cross), so you can count the "big chunks" without counting every cross.
 *
 * The WHOLE overlay is ONE inline-SVG tile (with an explicit viewBox): the dots
 * and BOTH cross weights share one coordinate system, so they can't drift apart
 * across engines / Retina (mixing a radial-gradient dot layer with an SVG cross
 * layer misaligned them on WKWebView — #89). The tile spans 16 cells when fine
 * (so the every-16th thick cross fits), else 4. Crosses are drawn first and the
 * dots after, so a dot sits in the middle of each "+". Pure → unit-tested.
 */
export function gridOverlayStyle(spacing: number): {
  backgroundImage: string; backgroundSize: string; backgroundPosition: string;
} {
  const g = spacing;
  const fine = g < 30;        // fine grid → add the every-16th "big chunk" cross
  const span = fine ? 16 : 4; // cells per tile (must hold the thick every-16 mark)
  const tile = span * g;
  const r = 1.5;              // fine-dot radius (px) — a crisp SVG disc reads bold
  // Crosses live at 2g, 6g, 10g… (every 4th line, offset 2). The one at (2g,2g)
  // is the every-16th anchor → thick on a fine grid; the rest stay thin.
  let thin = '', thick = '';
  for (let x = 2 * g; x < tile; x += 4 * g) {
    for (let y = 2 * g; y < tile; y += 4 * g) {
      if (fine && x === 2 * g && y === 2 * g) thick += crossPath(x, y, 8);
      else thin += crossPath(x, y, 6);
    }
  }
  // Dots at every grid point in [0, tile], INCLUDING the 0 and tile edges so they
  // compose seamlessly with the neighbouring tiles' edge dots when repeated.
  let dots = '';
  for (let i = 0; i <= span; i++) for (let j = 0; j <= span; j++) {
    dots += `<circle cx='${i * g}' cy='${j * g}' r='${r}'/>`;
  }
  // NB: NO shape-rendering='crispEdges' on the crosses — at a fine spacing the
  // canvas is downscaled enough that crisp-snapping a 1px stroke drops a whole
  // arm (a "+" becomes "—" or "|"); plain anti-aliased strokes keep both arms.
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${tile} ${tile}' ` +
    `width='${tile}' height='${tile}'>` +
    `<path d='${thin}' stroke='${MARK}' stroke-width='1' fill='none'/>` +
    (thick
      ? `<path d='${thick}' stroke='${MARK}' stroke-width='2' fill='none'/>`
      : '') +
    `<g fill='${MARK}'>${dots}</g>` +   // dots after the crosses → center dot on top
    `</svg>`;
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: `${tile}px ${tile}px`,
    backgroundPosition: '0 0',
  };
}

/**
 * Geometry for a single, slightly larger "+" cross marking the DEAD CENTER of
 * the slide (#89 follow-up) — independent of the grid spacing, so it always
 * marks 960×540.
 *
 * Rendered as an INLINE <svg> element (NOT a CSS background): a background-image
 * layer rasterizes + positions independently of the grid-overlay background, so
 * on Retina the two round to different device pixels and the center mark drifts
 * off the grid — the very offset bug we already fixed for the dots vs crosses
 * (#89). An inline SVG positioned by transform shares the canvas' own pixel
 * rounding, so it stays put. Pure → unit-tested.
 */
export function gridCenterCross(): {
  size: number; d: string; stroke: string; strokeWidth: number;
} {
  const s = 30, c = s / 2, a = 11;   // a ~22px cross in a 30px box
  return { size: s, d: crossPath(c, c, a), stroke: MARK, strokeWidth: 1.25 };
}
