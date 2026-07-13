import { describe, it, expect } from 'vitest';
import { arrowGeometry, triPoints, arrowBBox, arrowSvgInner, arrowInsertPoint } from './arrowGeometry.mjs';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const inset = 20 * Math.cos(Math.PI / 6);   // headSize * cos(30°) ≈ 17.32

describe('arrowGeometry (#98)', () => {
  it("default 'end': line stops at the head base (no poke-through), one head", () => {
    const g = arrowGeometry(0, 0, 100, 0, 20);          // heads undefined → 'end'
    expect(near(g.line.x1, 0)).toBe(true);              // start not inset
    expect(near(g.line.x2, 100 - inset)).toBe(true);    // end pulled back to head base
    expect(g.triangles.length).toBe(1);
    expect(g.triangles[0][0]).toEqual([100, 0]);        // tip at the true endpoint
  });

  it("'both': both ends inset, two heads", () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'both');
    expect(near(g.line.x1, inset)).toBe(true);
    expect(near(g.line.x2, 100 - inset)).toBe(true);
    expect(g.triangles.length).toBe(2);
    expect(g.triangles[1][0]).toEqual([0, 0]);          // start head tip at the start
  });

  it("'none': full-length line, no heads", () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'none');
    expect(g.line).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(g.triangles.length).toBe(0);
  });

  it("'start': only the start gets a head + inset", () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'start');
    expect(near(g.line.x1, inset)).toBe(true);
    expect(near(g.line.x2, 100)).toBe(true);
    expect(g.triangles.length).toBe(1);
  });

  it('the head base centre coincides with the line end (the actual fix)', () => {
    const g = arrowGeometry(10, 10, 90, 70, 24, 'end');
    const t = g.triangles[0];
    const baseMidX = (t[1][0] + t[2][0]) / 2, baseMidY = (t[1][1] + t[2][1]) / 2;
    expect(near(g.line.x2, baseMidX, 1e-9)).toBe(true);
    expect(near(g.line.y2, baseMidY, 1e-9)).toBe(true);
  });

  it("short arrow: 'both' insets clamp so the line never reverses", () => {
    // len 5 < combined inset (~34.6). Without the clamp x1→17.3, x2→-12.3 —
    // the stroke would run backwards and be longer than the arrow itself.
    const g = arrowGeometry(0, 0, 5, 0, 20, 'both');
    // Endpoints meet at the midpoint (per-head inset clamped to len/2 = 2.5),
    // so the line direction matches the arrow direction (x1 ≤ x2), never flips.
    expect(g.line.x1).toBeLessThanOrEqual(g.line.x2 + 1e-9);
    expect(near(g.line.x1, 2.5)).toBe(true);
    expect(near(g.line.x2, 2.5)).toBe(true);
    // Heads still drawn at the true endpoints, full size.
    expect(g.triangles[0][0]).toEqual([5, 0]);
    expect(g.triangles[1][0]).toEqual([0, 0]);
  });

  it("short arrow: single 'end' head inset clamps to the line length", () => {
    const g = arrowGeometry(0, 0, 5, 0, 20);   // 'end', len 5 < inset ~17.3
    expect(g.line.x1).toBe(0);                  // start untouched
    expect(near(g.line.x2, 0)).toBe(true);      // end pulled in at most to the start, not past
    expect(g.line.x2).toBeGreaterThanOrEqual(0);
  });

  it('triPoints + arrowBBox', () => {
    expect(triPoints([[1, 2], [3, 4]])).toBe('1,2 3,4');
    const bb = arrowBBox(0, 0, 100, 0, 20, 'both', 5);
    expect(bb.minX).toBeLessThanOrEqual(0);
    expect(bb.maxX).toBeGreaterThanOrEqual(100);
  });
});

describe('arrowGeometry curved (#129)', () => {
  it('partial control points → still straight (backward compat)', () => {
    // Only c1 given: not enough for a curve, falls back to the straight line.
    const g = arrowGeometry(0, 0, 100, 0, 20, 'end', 50, 40);
    expect(g.curved).toBeFalsy();
    expect(g.line).toBeTruthy();
    expect(g.path).toBeUndefined();
  });

  it('all four control points → cubic path, no line', () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'none', 20, 40, 80, 40);
    expect(g.curved).toBe(true);
    expect(g.line).toBeUndefined();
    // 'none' → endpoints untouched, path runs corner to corner through both ctrls.
    expect(g.path).toBe('M 0 0 C 20 40 80 40 100 0');
    expect(g.triangles.length).toBe(0);
  });

  it('end head points along the c2→end tangent, not the chord', () => {
    // c2 sits directly ABOVE the end, so the curve arrives heading straight down;
    // the head tip is at the true endpoint and its base is pulled back UPWARD.
    const g = arrowGeometry(0, 0, 100, 0, 20, 'end', 0, -40, 100, -40);
    const t = g.triangles[0];
    expect(t[0]).toEqual([100, 0]);                 // tip at the real endpoint
    const baseMidX = (t[1][0] + t[2][0]) / 2, baseMidY = (t[1][1] + t[2][1]) / 2;
    expect(near(baseMidX, 100)).toBe(true);         // base directly above tip
    expect(baseMidY).toBeLessThan(0);               // pulled UP along the tangent
    // Path end is pulled back to that base along the same tangent.
    expect(g.path.endsWith(`${baseMidX} ${baseMidY}`)).toBe(true);
  });

  it('arrowBBox includes the control points', () => {
    const bb = arrowBBox(0, 0, 100, 0, 20, 'none', 20, 0, 20, 200, 80);
    expect(bb.maxX).toBeGreaterThanOrEqual(200);    // c2x beyond both endpoints
    expect(bb.maxY).toBeGreaterThanOrEqual(80);     // c2y below the chord
  });

  it('interior points → a multi-segment cubic passing THROUGH each point', () => {
    // curved (all four controls) + one interior waypoint at (100,-50).
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', 40, 40, 160, 40, [{ x: 100, y: -50 }]);
    expect(g.curved).toBe(true);
    // Two cubic segments (one C per segment): start→point, point→end.
    expect((g.path.match(/C /g) || []).length).toBe(2);
    // The path visits the interior point exactly (it's a segment endpoint).
    expect(g.path).toContain('100 -50');
    // Start uses the c1 handle, end uses c2 (heads still orient to them).
    expect(g.path.startsWith('M 0 0 C 40 40')).toBe(true);
    expect(g.path).toContain('160 40 200 0');
  });

  it('no points → the single-segment cubic (unchanged)', () => {
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', 40, 40, 160, 40, []);
    expect(g.path).toBe('M 0 0 C 40 40 160 40 200 0');
  });

  it('arrowBBox includes interior points', () => {
    const bb = arrowBBox(0, 0, 200, 0, 20, 'none', 10, 40, 40, 160, 40, [{ x: 100, y: -80 }]);
    expect(bb.minY).toBeLessThanOrEqual(-80);
  });

  it('arrowInsertPoint: null when the arrow has no (full) handles', () => {
    expect(arrowInsertPoint(0, 0, 200, 0)).toBeNull();               // straight
    expect(arrowInsertPoint(0, 0, 200, 0, 50, -100)).toBeNull();     // partial handles
  });

  it('arrowInsertPoint: symmetric bow → knot at the apex (tangent ∥ chord)', () => {
    // Symmetric upward bow; the parallel-tangent point is the apex at t=0.5.
    const res = arrowInsertPoint(0, 0, 200, 0, 50, -100, 150, -100, []);
    expect(res.index).toBe(0);
    expect(res.points.length).toBe(1);
    const p = res.points[0];
    expect(Math.abs(p.x - 100)).toBeLessThan(2);   // apex x
    expect(Math.abs(p.y + 75)).toBeLessThan(2);    // apex y = -75
    // Endpoint handles halved toward their endpoints (de Casteljau L1/R1 at t=0.5).
    expect(res.c1x).toBe(25); expect(res.c1y).toBe(-50);    // lerp(start, c1, .5)
    expect(res.c2x).toBe(175); expect(res.c2y).toBe(-50);   // lerp(c2, end, .5)
  });

  it('arrowInsertPoint: the re-fit spline stays close to the original curve', () => {
    // Insert a knot, rebuild the two-segment path with the returned handles, and
    // confirm it tracks the original single cubic to within a few px everywhere.
    const c = [50, -100, 150, -100];
    const orig = arrowGeometry(0, 0, 200, 0, 20, 'none', ...c, []);
    const res = arrowInsertPoint(0, 0, 200, 0, ...c, []);
    const refit = arrowGeometry(0, 0, 200, 0, 20, 'none',
      res.c1x, res.c1y, res.c2x, res.c2y, res.points);
    // Sample both paths and take the max nearest-point gap (Hausdorff-ish).
    const sample = (d, N) => {
      // Evaluate an SVG "M .. C .. C .." path at N points per cubic segment.
      const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
      const segs = [];
      let cx = nums[0], cy = nums[1], i = 2;
      while (i + 5 < nums.length) {
        segs.push([[cx, cy], [nums[i], nums[i + 1]], [nums[i + 2], nums[i + 3]], [nums[i + 4], nums[i + 5]]]);
        cx = nums[i + 4]; cy = nums[i + 5]; i += 6;
      }
      const pts = [];
      for (const [P0, P1, P2, P3] of segs) {
        for (let k = 0; k <= N; k++) {
          const t = k / N, u = 1 - t, b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          pts.push([b[0] * P0[0] + b[1] * P1[0] + b[2] * P2[0] + b[3] * P3[0],
                    b[0] * P0[1] + b[1] * P1[1] + b[2] * P2[1] + b[3] * P3[1]]);
        }
      }
      return pts;
    };
    const A = sample(orig.path, 40), B = sample(refit.path, 40);
    let maxGap = 0;
    for (const a of A) {
      let best = Infinity;
      for (const b of B) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1]));
      maxGap = Math.max(maxGap, best);
    }
    expect(maxGap).toBeLessThan(5);   // re-fit tracks the original within ~5px
  });

  it('arrowInsertPoint: the new knot lies ON the existing curve (shape preserved)', () => {
    // A lopsided bow — parallel point is off-midpoint but still on the curve.
    const res = arrowInsertPoint(0, 0, 200, 0, 20, -120, 190, -30, []);
    const p = res.points[0];
    // Re-derive the single-segment cubic and confirm the point sits on it at
    // SOME t (min distance to the sampled curve ≈ 0).
    const P = [[0, 0], [20, -120], [190, -30], [200, 0]];
    const at = (t) => {
      const u = 1 - t, b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [b[0] * P[0][0] + b[1] * P[1][0] + b[2] * P[2][0] + b[3] * P[3][0],
              b[0] * P[0][1] + b[1] * P[1][1] + b[2] * P[2][1] + b[3] * P[3][1]];
    };
    let best = Infinity;
    for (let k = 0; k <= 200; k++) { const c = at(k / 200); best = Math.min(best, Math.hypot(c[0] - p.x, c[1] - p.y)); }
    expect(best).toBeLessThan(1.5);
    // And well clear of both endpoints (minGap honoured).
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(20);
    expect(Math.hypot(p.x - 200, p.y)).toBeGreaterThan(20);
  });

  it('arrowInsertPoint: splits the LONGEST segment', () => {
    // One existing knot near the start → segment 1 (knot→end) is far longer.
    const res = arrowInsertPoint(0, 0, 300, 0, 30, -60, 270, -60, [{ x: 60, y: -50 }]);
    expect(res.index).toBe(1);            // inserted into the second (long) segment
    expect(res.points.length).toBe(2);
    expect(res.points[0]).toEqual({ x: 60, y: -50 });   // original knot kept, order preserved
  });

  it('arrowSvgInner renders a <path> for a curved arrow', () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'none', 20, 40, 80, 40);
    const svg = arrowSvgInner(g, '#f00', 3);
    expect(svg).toContain('<path d="M 0 0 C 20 40 80 40 100 0"');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain('<line');
  });
});
