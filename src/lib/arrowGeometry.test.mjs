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

  it('interior points → pure Catmull-Rom spline, endpoints DERIVED (not c1/c2)', () => {
    // One waypoint at (100,-50). c1/c2 are passed but MUST be ignored — a
    // point-arrow smooths its ends toward the neighbour, no endpoint-slope memory.
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', 40, 40, 160, 40, [{ x: 100, y: -50 }]);
    expect(g.curved).toBe(true);
    expect((g.path.match(/C /g) || []).length).toBe(2);   // two cubic segments
    expect(g.path).toContain('100 -50');                  // visits the waypoint
    // The stored handles do NOT appear — the start control is K0+(K1-K0)/3 and the
    // end control is K2-(K2-K1)/3, both derived from the waypoint, not 40,40/160,40.
    expect(g.path.startsWith('M 0 0 C 40 40')).toBe(false);
    expect(g.path).not.toContain('160 40');
    // Derived start control ≈ (100/3, -50/3); derived end control ≈ (166.67, -16.67).
    expect(g.path).toMatch(/^M 0 0 C 33\.3/);
  });

  it('points imply curved even without c1/c2 handles', () => {
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', undefined, undefined, undefined, undefined, [{ x: 100, y: -50 }]);
    expect(g.curved).toBe(true);
    expect(g.path).toContain('100 -50');
    expect(g.line).toBeUndefined();
  });

  it('no points → the single-segment cubic (unchanged)', () => {
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', 40, 40, 160, 40, []);
    expect(g.path).toBe('M 0 0 C 40 40 160 40 200 0');
  });

  it('arrowBBox includes interior points', () => {
    const bb = arrowBBox(0, 0, 200, 0, 20, 'none', 10, 40, 40, 160, 40, [{ x: 100, y: -80 }]);
    expect(bb.minY).toBeLessThanOrEqual(-80);
  });

  it('arrowInsertPoint: straight arrow → the line midpoint (stays straight)', () => {
    // No points, no handles → one collinear waypoint at the middle. Catmull-Rom
    // through 3 collinear knots is still straight until the knot is dragged.
    const res = arrowInsertPoint(0, 0, 200, 0);
    expect(res.points).toEqual([{ x: 100, y: 0 }]);
    expect(res.index).toBe(0);
  });

  it('arrowInsertPoint: two-handle Bézier → samples the curve at t=0.5 (becomes a point)', () => {
    // Symmetric bow c1(50,-100) c2(150,-100). The cubic at t=0.5 is (100,-75).
    // The caller drops c1/c2; this returns just the on-curve waypoint.
    const res = arrowInsertPoint(0, 0, 200, 0, [], 50, -100, 150, -100);
    expect(res.points).toEqual([{ x: 100, y: -75 }]);
    expect(res.index).toBe(0);
  });

  it('arrowInsertPoint: existing points → new knot on the LONGEST segment, order kept', () => {
    // Knot near the start → segment 1 (knot→end) is far longer, so the new knot
    // lands there (index 1), after the original.
    const res = arrowInsertPoint(0, 0, 300, 0, [{ x: 60, y: -50 }]);
    expect(res.index).toBe(1);
    expect(res.points.length).toBe(2);
    expect(res.points[0]).toEqual({ x: 60, y: -50 });        // original kept, order preserved
    expect(res.points[1].x).toBeGreaterThan(60);             // new knot in the second half
    expect(res.points[1].x).toBeLessThan(300);
  });

  it('arrowInsertPoint: the new knot lies ON the current Catmull-Rom curve', () => {
    // Insert into a one-point arrow, then confirm the new knot sits on the rendered
    // curve (min distance to the sampled path ≈ 0) — so "+ Point" doesn't jump.
    const res = arrowInsertPoint(0, 0, 200, 0, [{ x: 100, y: -60 }]);
    const p = res.points.find((q) => !(q.x === 100 && q.y === -60));
    const g = arrowGeometry(0, 0, 200, 0, 20, 'none', undefined, undefined, undefined, undefined, [{ x: 100, y: -60 }]);
    const nums = g.path.match(/-?\d+(\.\d+)?/g).map(Number);
    const segs = [];
    let cx = nums[0], cy = nums[1], i = 2;
    while (i + 5 < nums.length) { segs.push([[cx, cy], [nums[i], nums[i + 1]], [nums[i + 2], nums[i + 3]], [nums[i + 4], nums[i + 5]]]); cx = nums[i + 4]; cy = nums[i + 5]; i += 6; }
    let best = Infinity;
    for (const [P0, P1, P2, P3] of segs) for (let k = 0; k <= 100; k++) {
      const t = k / 100, u = 1 - t, b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const x = b[0] * P0[0] + b[1] * P1[0] + b[2] * P2[0] + b[3] * P3[0];
      const y = b[0] * P0[1] + b[1] * P1[1] + b[2] * P2[1] + b[3] * P3[1];
      best = Math.min(best, Math.hypot(x - p.x, y - p.y));
    }
    expect(best).toBeLessThan(1.5);
  });

  it('arrowSvgInner renders a <path> for a curved arrow', () => {
    const g = arrowGeometry(0, 0, 100, 0, 20, 'none', 20, 40, 80, 40);
    const svg = arrowSvgInner(g, '#f00', 3);
    expect(svg).toContain('<path d="M 0 0 C 20 40 80 40 100 0"');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain('<line');
  });
});
