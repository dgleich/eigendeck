import { describe, it, expect } from 'vitest';
import { snapToGrid, gridOverlayStyle } from './grid';

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
});
