import { describe, it, expect } from 'vitest';
import { arrowGeometry, triPoints, arrowBBox } from './arrowGeometry.mjs';

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

  it('triPoints + arrowBBox', () => {
    expect(triPoints([[1, 2], [3, 4]])).toBe('1,2 3,4');
    const bb = arrowBBox(0, 0, 100, 0, 20, 'both', 5);
    expect(bb.minX).toBeLessThanOrEqual(0);
    expect(bb.maxX).toBeGreaterThanOrEqual(100);
  });
});
