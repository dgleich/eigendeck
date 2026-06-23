import { describe, it, expect } from 'vitest';
import { snapToGrid, gridOverlaySvg } from './grid';

const W = 1920, H = 1080;

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

describe('gridOverlaySvg (#89: ONE full-slide svg — dots, crosses, center mark)', () => {
  it('is a single full-slide <svg> with a tiling <pattern> (no CSS background to drift)', () => {
    const svg = gridOverlaySvg(30, W, H);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width='${W}'`);
    expect(svg).toContain(`viewBox='0 0 ${W} ${H}'`);
    expect(svg).toContain("<pattern id='eigendeck-grid'");
    expect(svg).toContain("fill='url(#eigendeck-grid)'");
    expect(svg).not.toContain('radial-gradient');
  });

  it('the pattern tile is 4× the spacing on a coarse grid', () => {
    expect(gridOverlaySvg(30, W, H)).toContain("width='120' height='120'"); // 4 × 30
    expect(gridOverlaySvg(40, W, H)).toContain("width='160' height='160'"); // 4 × 40
  });

  it('puts the DEAD-CENTER "+" at the true slide center, in the same svg/raster', () => {
    const svg = gridOverlaySvg(30, W, H);
    // arms centered at (960, 540) — drawn in the SAME user space as the pattern,
    // so it can't drift off the dot grid (the #89 offset bug).
    expect(svg).toMatch(/M960 \d+V\d+M\d+ 540H\d+/);
    expect(svg).toContain('rgba(100,116,139,0.55)'); // single light grey throughout
  });

  it('at 30px the slide center is itself a grid point (so the "+" lands on a dot)', () => {
    expect(960 % 30).toBe(0);
    expect(540 % 30).toBe(0);
  });

  it('draws a coarse "+" cross at 2g and dots only at the tile leading edge [0, span)', () => {
    const svg = gridOverlaySvg(30, W, H);
    expect(svg).toMatch(/M60 \d+V\d+M\d+ 60H\d+/);   // cross at 2g = 60
    expect(svg).toContain("cx='0'");                  // leading-edge dot (tiled to all lines)
    expect(svg).toContain("cx='90'");                 // interior dot at 3g
    expect(svg).not.toContain("cx='120'");            // NOT the trailing edge (tiling makes it)
  });

  it('a COARSE grid (spacing ≥ 30) has NO thick "big chunk" cross (single weight)', () => {
    const svg = gridOverlaySvg(40, W, H);
    expect(svg).toContain("stroke-width='1'");
    // only the center "+" is heavier (1.5); there is no every-16 thick (2) tier
    expect(svg).not.toContain("stroke-width='2'");
  });

  it('a FINE grid (spacing < 30) uses a 16-cell tile and a thicker "+" every 16th cell', () => {
    const svg = gridOverlaySvg(20, W, H); // 20 < 30 → fine
    expect(svg).toContain("width='320' height='320'"); // 16 × 20 pattern tile
    expect(svg).toContain("stroke-width='1'");
    expect(svg).toContain("stroke-width='2'");          // the big-chunk cross
    // the thick cross is anchored at the every-16th point (2g,2g)=(40,40)
    expect(svg).toMatch(/M40 \d+V\d+M\d+ 40H\d+[^]*stroke-width='2'/);
  });
});
