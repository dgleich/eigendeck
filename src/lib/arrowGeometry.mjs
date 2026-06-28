// Shared arrow geometry — used by the editor, present mode, and HTML export so
// the three never drift (#98). Produces:
//   • line endpoints pulled back to the head BASE on any headed end, so the
//     stroke meets the head cleanly instead of poking through the tip; and
//   • the head triangle(s).
// `heads`: 'end' (default) | 'start' | 'both' | 'none'.

export const ARROW_HA = Math.PI / 6;   // head half-angle (30°)

export function arrowGeometry(x1, y1, x2, y2, headSize, heads) {
  const ha = ARROW_HA;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const inset = headSize * Math.cos(ha);                 // tip → base-centre distance along the line
  const atEnd = heads !== 'start' && heads !== 'none';   // default/'end'/'both'
  const atStart = heads === 'start' || heads === 'both';
  const tri = (tx, ty, a) => [
    [tx, ty],
    [tx - headSize * Math.cos(a - ha), ty - headSize * Math.sin(a - ha)],
    [tx - headSize * Math.cos(a + ha), ty - headSize * Math.sin(a + ha)],
  ];
  const triangles = [];
  if (atEnd) triangles.push(tri(x2, y2, ang));
  if (atStart) triangles.push(tri(x1, y1, ang + Math.PI));
  return {
    line: {
      x1: atStart ? x1 + ux * inset : x1, y1: atStart ? y1 + uy * inset : y1,
      x2: atEnd ? x2 - ux * inset : x2, y2: atEnd ? y2 - uy * inset : y2,
    },
    triangles,   // each: [[x,y],[x,y],[x,y]]
  };
}

/** An SVG `points` string for one triangle. */
export function triPoints(t) {
  return t.map((p) => p[0] + ',' + p[1]).join(' ');
}

/** Bounding box over endpoints + head corners (editor hit-area), padded. */
export function arrowBBox(x1, y1, x2, y2, headSize, heads, pad) {
  const g = arrowGeometry(x1, y1, x2, y2, headSize, heads);
  const xs = [x1, x2], ys = [y1, y2];
  for (const t of g.triangles) for (const p of t) { xs.push(p[0]); ys.push(p[1]); }
  pad = pad || 0;
  return {
    minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad,
  };
}
