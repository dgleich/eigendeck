// Shared arrow geometry — used by the editor, present mode, and HTML export so
// the three never drift (#98). Produces:
//   • line endpoints pulled back to the head BASE on any headed end, so the
//     stroke meets the head cleanly instead of poking through the tip; and
//   • the head triangle(s).
// `heads`: 'end' (default) | 'start' | 'both' | 'none'.

const ARROW_HA = Math.PI / 6;   // head half-angle (30°)

export function arrowGeometry(x1, y1, x2, y2, headSize, heads, c1x, c1y, c2x, c2y, points) {
  const ha = ARROW_HA;
  const pts = Array.isArray(points) ? points.filter((p) => p && p.x != null && p.y != null) : [];
  const hasPts = pts.length > 0;
  // Two shapes beyond a straight line (#129):
  //   • interior waypoints  → a pure Catmull-Rom spline through [start, …pts, end].
  //     EVERY tangent, including the two endpoints, is DERIVED from the adjacent
  //     knot (the endpoints one-sided). No stored c1/c2 memory — the ends smooth
  //     toward the neighbouring point. Waypoints take precedence over c1/c2.
  //   • two Bézier handles (c1/c2, no waypoints) → a single cubic the user shaped.
  const hasHandles = c1x != null && c1y != null && c2x != null && c2y != null;
  const curved = hasHandles || hasPts;
  // Head angle at each tip = the curve TANGENT there (straight: the line dir).
  let endAng, startAng;
  if (hasPts) {
    // Derived end tangents: end head along (lastPt→end), start head outward (firstPt→start).
    const first = pts[0], last = pts[pts.length - 1];
    endAng = Math.atan2(y2 - last.y, x2 - last.x);
    startAng = Math.atan2(y1 - first.y, x1 - first.x);
  } else if (hasHandles) {
    // end head along c2→end; start head points OUTWARD along c1→start.
    endAng = Math.atan2(y2 - c2y, x2 - c2x);
    startAng = Math.atan2(y1 - c1y, x1 - c1x);
  } else {
    endAng = Math.atan2(y2 - y1, x2 - x1);
    startAng = Math.atan2(y1 - y2, x1 - x2);
  }
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
    if (!hasPts) {
      // Two-handle Bézier the user shaped directly.
      return { curved: true, path: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`, triangles };
    }
    // Pure Catmull-Rom spline through [start, …pts, end]. Tangent at knot i is
    // (K[i+1] − K[i−1])/2, giving Bézier controls K[i] ± (K[i+1] − K[i−1])/6. The
    // two ENDPOINTS use a one-sided difference (K[1] − K[0], K[n−1] − K[n−2]) — so
    // no c1/c2 memory; the ends bend toward the neighbouring point like every knot.
    const K = [{ x: sx, y: sy }, ...pts, { x: ex, y: ey }];
    const n = K.length;
    const outC = new Array(n);
    const inC = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        outC[0] = { x: K[0].x + (K[1].x - K[0].x) / 3, y: K[0].y + (K[1].y - K[0].y) / 3 };
      } else if (i === n - 1) {
        inC[n - 1] = { x: K[n - 1].x - (K[n - 1].x - K[n - 2].x) / 3, y: K[n - 1].y - (K[n - 1].y - K[n - 2].y) / 3 };
      } else {
        const tx = (K[i + 1].x - K[i - 1].x) / 6, ty = (K[i + 1].y - K[i - 1].y) / 6;
        outC[i] = { x: K[i].x + tx, y: K[i].y + ty };
        inC[i] = { x: K[i].x - tx, y: K[i].y - ty };
      }
    }
    let d = `M ${sx} ${sy}`;
    for (let i = 0; i < n - 1; i++) {
      d += ` C ${outC[i].x} ${outC[i].y} ${inC[i + 1].x} ${inC[i + 1].y} ${K[i + 1].x} ${K[i + 1].y}`;
    }
    return { curved: true, path: d, triangles };
  }
  return {
    line: { x1: sx, y1: sy, x2: ex, y2: ey },
    triangles,   // each: [[x,y],[x,y],[x,y]]
  };
}

/** Insert a new interior waypoint ON the current curve, at the midpoint of its
 *  LONGEST segment, so the arrow keeps its shape and just gains a draggable knot.
 *  The result is always a pure Catmull-Rom point-arrow (the caller drops c1/c2):
 *    • already has points → sample the longest Catmull-Rom segment at its middle;
 *    • a two-handle Bézier (c1/c2 given, no points) → sample that cubic at t=0.5
 *      (converts it to a point-arrow that follows the bend);
 *    • straight → the line midpoint (stays straight until the knot is dragged).
 *  Returns `{ points, index }` — the new waypoint array and the inserted index.
 */
export function arrowInsertPoint(x1, y1, x2, y2, points, c1x, c1y, c2x, c2y) {
  const pts = Array.isArray(points) ? points.filter((p) => p && p.x != null && p.y != null) : [];
  const cubicAt = (P0, P1, P2, P3, t) => {
    const u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    return {
      x: b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x,
      y: b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y,
    };
  };
  const round = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });

  if (pts.length > 0) {
    // Catmull-Rom controls exactly as arrowGeometry builds them (one-sided ends);
    // sample the longest segment at its middle to place the new knot on the curve.
    const K = [{ x: x1, y: y1 }, ...pts, { x: x2, y: y2 }];
    const n = K.length;
    const outC = new Array(n), inC = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0) outC[0] = { x: K[0].x + (K[1].x - K[0].x) / 3, y: K[0].y + (K[1].y - K[0].y) / 3 };
      else if (i === n - 1) inC[n - 1] = { x: K[n - 1].x - (K[n - 1].x - K[n - 2].x) / 3, y: K[n - 1].y - (K[n - 1].y - K[n - 2].y) / 3 };
      else {
        const tx = (K[i + 1].x - K[i - 1].x) / 6, ty = (K[i + 1].y - K[i - 1].y) / 6;
        outC[i] = { x: K[i].x + tx, y: K[i].y + ty };
        inC[i] = { x: K[i].x - tx, y: K[i].y - ty };
      }
    }
    let seg = 0, best = -1;
    for (let i = 0; i < n - 1; i++) {
      const L = Math.hypot(K[i + 1].x - K[i].x, K[i + 1].y - K[i].y);
      if (L > best) { best = L; seg = i; }
    }
    const np = round(cubicAt(K[seg], outC[seg], inC[seg + 1], K[seg + 1], 0.5));
    const newPts = [...pts];
    newPts.splice(seg, 0, np);
    return { points: newPts, index: seg };
  }

  if (c1x != null && c1y != null && c2x != null && c2y != null) {
    // Two-handle Bézier → sample it at the midpoint and become a point-arrow.
    const np = round(cubicAt({ x: x1, y: y1 }, { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x: x2, y: y2 }, 0.5));
    return { points: [np], index: 0 };
  }
  // Straight → the line midpoint (collinear, so it stays straight until dragged).
  return { points: [round({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 })], index: 0 };
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
