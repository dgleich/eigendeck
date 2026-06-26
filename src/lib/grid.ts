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

/**
 * New size for a bottom-right (SE) resize that snaps the moving EDGE to the grid
 * rather than the size itself (#97).
 *
 * Snapping width/height directly leaves the far edge off-grid whenever the
 * element's `origin` (x or y) isn't grid-aligned — e.g. origin 130, width
 * snapped to 200 → right edge 330, not on a 30px grid. Instead we snap the edge
 * (`origin + rawSize`) and derive the size back from the fixed origin, so the
 * edge lands on a gridline and only the size absorbs the origin's offset.
 *
 * `spacing < 2` (or non-finite) means "no grid" — pass 0 when snap is off or
 * bypassed and the raw size is returned (clamped/rounded). Result is clamped to
 * `minSize` and rounded to whole px.
 */
export function resizeEdgeToGrid(
  origin: number,
  rawSize: number,
  spacing: number,
  minSize: number,
): number {
  const edge = snapToGrid(origin + rawSize, spacing);
  return Math.max(minSize, Math.round(edge - origin));
}

// Grid overlay marker color (light slate) — every tier (dots, thin/thick "+"
// crosses, the dead-center "+") uses this SAME light grey; they're told apart by
// shape and stroke weight, never by colour, so the grid stays unobtrusive.
const MARK = 'rgba(100,116,139,0.55)';

// A single "+" SVG path centered at (x,y) with arm half-length a.
const crossPath = (x: number, y: number, a: number) =>
  `M${x} ${y - a}V${y + a}M${x - a} ${y}H${x + a}`;

/**
 * The complete editor alignment-grid overlay (#89) as ONE inline-SVG markup
 * string, sized to the whole slide (width × height). Three tiers of marker, all
 * in the SAME light grey — distinguished by SHAPE/WEIGHT, not colour:
 *
 *   1. a FINE dot at every grid point (0, g, 2g…);
 *   2. a thin "+" CROSS every 4th cell (offset 2 cells in → on the grid points
 *      2g, 6g, 10g…), a coarse reference that reads at a glance;
 *   3. on a FINE grid only (spacing < 30, e.g. 12/15/20/24, where the every-4th
 *      crosses get dense), a slightly THICKER "+" every 16th cell (every 4th
 *      cross), so you can count the "big chunks" without counting every cross;
 *
 *   plus a single, larger "+" marking the DEAD CENTER of the slide.
 *
 * Why one full-slide SVG and not a repeating CSS background tile + a separate
 * center element: the center mark kept drifting ~1px off the dot grid on
 * Retina/fractional-scale (#89). A CSS background and an absolutely-positioned
 * element rasterize in DIFFERENT compositing layers, each rounded to device
 * pixels independently under the canvas' `transform: scale()`. Drawing the
 * repeating tiers (via a <pattern>) AND the center cross in ONE <svg> puts them
 * in one user-space and one raster, so nothing can drift relative to anything
 * else.
 *
 * Dots are drawn only at the pattern tile's leading/interior corners ([0, span)
 * in each axis); the <pattern> clips overflow and the tiling reproduces the
 * trailing-edge dots, yielding one full dot at every grid line with no
 * double-painting. No shape-rendering='crispEdges' on the crosses — at a fine
 * spacing the canvas is downscaled enough that crisp-snapping a 1px stroke drops
 * a whole arm (a "+" becomes "—" or "|"); plain anti-aliasing keeps both arms.
 * Pure → unit-tested.
 */
export function gridOverlaySvg(spacing: number, width: number, height: number): string {
  const g = spacing;
  const fine = g < 30;        // fine grid → add the every-16th "big chunk" cross
  const span = fine ? 16 : 4; // cells per pattern tile (holds the every-16 mark)
  const tile = span * g;
  const r = 1.5;              // fine-dot radius (slide px) — a crisp disc reads bold
  // Crosses live at 2g, 6g, 10g… (every 4th line, offset 2). The one at (2g,2g)
  // is the every-16th anchor → thick on a fine grid; the rest stay thin.
  let thin = '', thick = '';
  for (let x = 2 * g; x < tile; x += 4 * g) {
    for (let y = 2 * g; y < tile; y += 4 * g) {
      if (fine && x === 2 * g && y === 2 * g) thick += crossPath(x, y, 8);
      else thin += crossPath(x, y, 6);
    }
  }
  let dots = '';
  for (let i = 0; i < span; i++) for (let j = 0; j < span; j++) {
    dots += `<circle cx='${i * g}' cy='${j * g}' r='${r}'/>`;
  }
  // The dead-center mark: a larger "+" at the true slide center. At the default
  // 30px spacing the center (960,540) is itself a grid dot, so it reads as a
  // bullseye; at other spacings it just marks center.
  const center = crossPath(width / 2, height / 2, 12);
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' ` +
    `viewBox='0 0 ${width} ${height}'>` +
    `<defs><pattern id='eigendeck-grid' width='${tile}' height='${tile}' patternUnits='userSpaceOnUse'>` +
    `<path d='${thin}' stroke='${MARK}' stroke-width='1' fill='none'/>` +
    (thick ? `<path d='${thick}' stroke='${MARK}' stroke-width='2' fill='none'/>` : '') +
    `<g fill='${MARK}'>${dots}</g>` +
    `</pattern></defs>` +
    `<rect width='${width}' height='${height}' fill='url(#eigendeck-grid)'/>` +
    `<path d='${center}' stroke='${MARK}' stroke-width='1.5' fill='none'/>` +
    `</svg>`
  );
}
