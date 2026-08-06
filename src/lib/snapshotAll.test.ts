import { describe, it, expect } from 'vitest';
import { planSnapshotCapture, type LiveEntry } from './snapshotAll';

const e = (slideIdx: number, present: boolean, themeStale = false): LiveEntry => ({ slideIdx, present, themeStale });

describe('planSnapshotCapture (Generate Missing / Refresh All decision)', () => {
  it('Generate Missing: captures ONLY missing/stale, visits only their slides', () => {
    const r = planSnapshotCapture([
      e(0, true),          // present, current → skip
      e(1, false),         // missing → capture
      e(2, true, true),    // theme-stale → capture
      e(2, true),          // present on the same slide → doesn't add the slide again
    ], false);
    expect(r.captured).toBe(2);
    expect(r.slidesToVisit).toEqual([1, 2]);
  });

  it('idempotent: everything present + current → visits nothing (the reported bug)', () => {
    const r = planSnapshotCapture([e(0, true), e(1, true), e(3, true)], false);
    expect(r.captured).toBe(0);
    expect(r.slidesToVisit).toEqual([]);
  });

  it('Refresh All (force): captures EVERYTHING, even present + current previews', () => {
    const r = planSnapshotCapture([e(0, true), e(1, true), e(2, true)], true);
    expect(r.captured).toBe(3);
    expect(r.slidesToVisit).toEqual([0, 1, 2]);
  });

  it('dedups + sorts slide indices (multiple needy elements per slide, out of order)', () => {
    const r = planSnapshotCapture([e(5, false), e(2, false), e(5, false), e(2, true, true)], false);
    expect(r.captured).toBe(4);
    expect(r.slidesToVisit).toEqual([2, 5]);
  });

  it('no live elements → nothing to do', () => {
    expect(planSnapshotCapture([], false)).toEqual({ slidesToVisit: [], captured: 0 });
    expect(planSnapshotCapture([], true)).toEqual({ slidesToVisit: [], captured: 0 });
  });

  it('a slide with a mix (one present, one missing) is still visited (for the missing one)', () => {
    const r = planSnapshotCapture([e(4, true), e(4, false)], false);
    expect(r.captured).toBe(1);
    expect(r.slidesToVisit).toEqual([4]);
  });
});
