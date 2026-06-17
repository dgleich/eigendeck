import { describe, it, expect } from 'vitest';
import { snapToGrid } from './grid';

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
