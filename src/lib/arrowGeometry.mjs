// Shared arrow geometry — used by the editor, present mode, and HTML export so
// the three never drift (#98). Produces:
//   • line endpoints pulled back to the head BASE on any headed end, so the
//     stroke meets the head cleanly instead of poking through the tip; and
//   • the head triangle(s).
// `heads`: 'end' (default) | 'start' | 'both' | 'none'.

const ARROW_HA = Math.PI / 6;   // head half-angle (30°)

export function arrowGeometry(x1, y1, x2, y2, headSize, heads, c1x, c1y, c2x, c2y, points) {
  const ha = ARROW_HA;
  // Cubic-Bézier control points (#129): c1 off the start, c2 off the end. When all
  // four are present the arrow curves; otherwise it's a straight line (unchanged).
  const curved = c1x != null && c1y != null && c2x != null && c2y != null;
  // Head angle at each tip = the curve TANGENT there (straight: the line dir).
  // end head points along c2→end; start head points OUTWARD along c1→start.
  const endAng = curved ? Math.atan2(y2 - c2y, x2 - c2x) : Math.atan2(y2 - y1, x2 - x1);
  const startAng = curved ? Math.atan2(y1 - c1y, x1 - c1x) : Math.atan2(y1 - y2, x1 - x2);
  const atEnd = heads !== 'start' && heads !== 'none';   // default/'end'/'both'
  const atStart = heads === 'start' || heads === 'both';
  // tip → base-centre distance. For an arrow shorter than the combined insets,
  // pulling both endpoints in would make them cross; clamp by the straight-line
  // length so at worst they meet (never reverse). The curved arc is longer, so
  // this stays conservative there.
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nHeads = (atStart ? 1 : 0) + (atEnd ? 1 : 0);
  const inset = nHeads > 0
    ? Math.min(headSize * Math.cos(ha), len / nHeads)
    : headSize * Math.cos(ha);
  const tri = (tx, ty, a) => [
    [tx, ty],
    [tx - headSize * Math.cos(a - ha), ty - headSize * Math.sin(a - ha)],
    [tx - headSize * Math.cos(a + ha), ty - headSize * Math.sin(a + ha)],
  ];
  const triangles = [];
  if (atEnd) triangles.push(tri(x2, y2, endAng));
  if (atStart) triangles.push(tri(x1, y1, startAng));
  // Pull each headed endpoint back to the head base ALONG its tangent — the stroke
  // meets the head cleanly on the curve too (keeps the control points fixed).
  const ex = atEnd ? x2 - Math.cos(endAng) * inset : x2;
  const ey = atEnd ? y2 - Math.sin(endAng) * inset : y2;
  const sx = atStart ? x1 - Math.cos(startAng) * inset : x1;
  const sy = atStart ? y1 - Math.sin(startAng) * inset : y1;
  if (curved) {
    const pts = Array.isArray(points) ? points.filter((p) => p && p.x != null && p.y != null) : [];
    if (pts.length === 0) {
      return { curved: true, path: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`, triangles };
    }
    // Interior interpolation points (#129): the curve passes THROUGH each point,
    // smoothly. The two END tangents keep coming from the user handles (c1/c2, so
    // the heads orient exactly as before); interior knots get automatic
    // Catmull-Rom tangents (T = (next − prev)/6). No handles on interior points.
    const K = [{ x: sx, y: sy }, ...pts, { x: ex, y: ey }];
    const outC = new Array(K.length);
    const inC = new Array(K.length);
    outC[0] = { x: c1x, y: c1y };
    inC[K.length - 1] = { x: c2x, y: c2y };
    for (let i = 1; i < K.length - 1; i++) {
      const tx = (K[i + 1].x - K[i - 1].x) / 6, ty = (K[i + 1].y - K[i - 1].y) / 6;
      outC[i] = { x: K[i].x + tx, y: K[i].y + ty };
      inC[i] = { x: K[i].x - tx, y: K[i].y - ty };
    }
    let d = `M ${sx} ${sy}`;
    for (let i = 0; i < K.length - 1; i++) {
      d += ` C ${outC[i].x} ${outC[i].y} ${inC[i + 1].x} ${inC[i + 1].y} ${K[i + 1].x} ${K[i + 1].y}`;
    }
    return { curved: true, path: d, triangles };
  }
  return {
    line: { x1: sx, y1: sy, x2: ex, y2: ey },
    triangles,   // each: [[x,y],[x,y],[x,y]]
  };
}

/** An SVG `points` string for one triangle. */
export function triPoints(t) {
  return t.map((p) => p[0] + ',' + p[1]).join(' ');
}

/** SVG-STRING inner `<g>` for an arrow — the inset line + head polygon(s) wrapped
 *  in `<g [opacity]>`. Shared by the HTML/string render targets (exportCore HTML
 *  export + App.tsx print-to-PDF), which built this identically. The caller
 *  supplies its own `<svg>` wrapper. */
export function arrowSvgInner(geo, color, strokeWidth, opacity) {
  const op = opacity != null && opacity < 1 ? ` opacity="${opacity}"` : '';
  const stroke = geo.path
    ? `<path d="${geo.path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>`
    : `<line x1="${geo.line.x1}" y1="${geo.line.y1}" x2="${geo.line.x2}" y2="${geo.line.y2}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  const heads = geo.triangles.map((t) => `<polygon points="${triPoints(t)}" fill="${color}"/>`).join('');
  return `<g${op}>${stroke}${heads}</g>`;
}

/** Bounding box over endpoints + head corners (editor hit-area), padded. Includes
 *  the Bézier control points when present — the curve stays within the convex hull
 *  of {endpoints, control points}, so this bounds it. */
export function arrowBBox(x1, y1, x2, y2, headSize, heads, pad, c1x, c1y, c2x, c2y, points) {
  const g = arrowGeometry(x1, y1, x2, y2, headSize, heads, c1x, c1y, c2x, c2y, points);
  const xs = [x1, x2], ys = [y1, y2];
  if (c1x != null && c1y != null && c2x != null && c2y != null) { xs.push(c1x, c2x); ys.push(c1y, c2y); }
  if (Array.isArray(points)) for (const p of points) { if (p && p.x != null) { xs.push(p.x); ys.push(p.y); } }
  for (const t of g.triangles) for (const p of t) { xs.push(p[0]); ys.push(p[1]); }
  pad = pad || 0;
  return {
    minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad,
  };
}
