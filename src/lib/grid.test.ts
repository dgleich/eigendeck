import { describe, it, expect } from 'vitest';
import { snapToGrid, gridOverlayStyle, gridCenterCross } from './grid';

describe('snapToGrid', () => {
  it('rounds to the nearest multiple of the spacing', () => {
    expect(snapToGrid(137, 80)).toBe(160);
    expect(snapToGrid(223, 80)).toBe(240);
    expect(snapToGrid(39, 40)).toBe(40);
    expect(snapToGrid(0, 40)).toBe(0);
  });

  it('leaves exact multiples untouched', () => {
    expect(snapToGrid(160, 80)).toBe(160);
    expect(snapToGrid(1920, 40)).toBe(1920);
  });

  it('rounds halfway up (Math.round behaviour)', () => {
    expect(snapToGrid(20, 40)).toBe(40); // 0.5 -> 1
    expect(snapToGrid(120, 80)).toBe(160); // 1.5 -> 2
  });

  it('snaps negative coordinates symmetrically', () => {
    expect(snapToGrid(-30, 40)).toBe(-40);
    expect(snapToGrid(-10, 40)).toBe(-0);
  });

  it('treats a spacing below 2px as "no grid" (returns value unchanged)', () => {
    expect(snapToGrid(137, 1)).toBe(137);
    expect(snapToGrid(137, 0)).toBe(137);
    expect(snapToGrid(137, -5)).toBe(137);
  });

  it('returns the value unchanged for a non-finite spacing', () => {
    expect(snapToGrid(137, NaN)).toBe(137);
    expect(snapToGrid(137, Infinity)).toBe(137);
  });
});

describe('gridOverlayStyle (#89: small + crosses every 4th, dots+cross in ONE svg)', () => {
  it('is a single SVG tile sized to 4× the spacing (no second layer to drift)', () => {
    expect(gridOverlayStyle(80).backgroundImage).toContain('data:image/svg');
    expect(gridOverlayStyle(80).backgroundImage).not.toContain('radial-gradient');
    expect(gridOverlayStyle(80).backgroundSize).toBe('320px 320px');
    expect(gridOverlayStyle(40).backgroundSize).toBe('160px 160px');
    expect(gridOverlayStyle(80).backgroundPosition).toBe('0 0');
  });

  it('has an explicit viewBox so it scales identically on every engine/Retina', () => {
    expect(decodeURIComponent(gridOverlayStyle(80).backgroundImage)).toContain("viewBox='0 0 320 320'");
  });

  it('draws a small "+" cross centered on the grid point at 2× spacing (2g)', () => {
    const svg = decodeURIComponent(gridOverlayStyle(80).backgroundImage);
    expect(svg).toMatch(/M160 \d+V\d+M\d+ 160H\d+/); // arms centered at 160 = 2g
    expect(decodeURIComponent(gridOverlayStyle(40).backgroundImage)).toMatch(/M80 \d+V/);
  });

  it('places a fine dot at every grid point AND at the cross center (same svg → aligned)', () => {
    const svg = decodeURIComponent(gridOverlayStyle(80).backgroundImage);
    for (const p of [0, 80, 160, 240, 320]) expect(svg).toContain(`cx='${p}'`); // dots every g
    expect(svg).toContain("cx='160' cy='160'"); // a dot exactly at the cross center (2g,2g)
  });

  it('draws the cross first and the dots after, so the center dot is the bullseye', () => {
    const svg = decodeURIComponent(gridOverlayStyle(80).backgroundImage);
    expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('<circle'));
    expect(svg).toContain('rgba(100,116,139,0.55)'); // single light grey for both
  });

  it('a COARSE grid (spacing ≥ 30) has NO thick "big chunk" cross (single weight)', () => {
    const svg = decodeURIComponent(gridOverlayStyle(40).backgroundImage);
    expect(svg).toContain("stroke-width='1'");
    expect(svg).not.toContain("stroke-width='2'");
  });

  it('a FINE grid (spacing < 30) spans 16 cells and adds a thicker "+" every 16th cell', () => {
    const style = gridOverlayStyle(20); // 20 < 30 → fine
    expect(style.backgroundSize).toBe('320px 320px'); // 16 × 20
    const svg = decodeURIComponent(style.backgroundImage);
    expect(svg).toContain("viewBox='0 0 320 320'");
    // thin crosses (weight 1) plus a THICK cross (weight 2) for the big chunks
    expect(svg).toContain("stroke-width='1'");
    expect(svg).toContain("stroke-width='2'");
    // the thick cross is anchored at the every-16th point (2g,2g)=(40,40)
    expect(svg).toMatch(/M40 \d+V\d+M\d+ 40H\d+[^]*stroke-width='2'/);
    // and still a fine dot at that thick-cross center
    expect(svg).toContain("cx='40' cy='40'");
  });
});

describe('gridCenterCross (#89: dead-center marker, inline svg)', () => {
  it('is a "+" path centered in a 30px box, drawn in the same light grey', () => {
    const c = gridCenterCross();
    expect(c.size).toBe(30);
    expect(c.d).toMatch(/^M15 \d+V\d+M\d+ 15H\d+$/); // arms centered at 15 = box center
    expect(c.stroke).toBe('rgba(100,116,139,0.55)');
    expect(c.strokeWidth).toBeGreaterThan(1); // a touch heavier than the grid crosses
  });
});
