import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks for external boundaries ---------------------------------------
// previewCache: previewKey is trivial (syncId ?? id); the rest touch SQLite/
// Tauri so we drive them with vi.fn and configure per-test.
vi.mock('./previewCache', () => ({
  previewKey: (el: { id: string; syncId?: string }) => el.syncId ?? el.id,
  clearPreview: vi.fn(async () => {}),
  loadPreviewDataUrl: vi.fn(async () => null as string | null),
  isPreviewThemeStale: vi.fn(async () => false),
}));

// themes: pure-ish, but they read a theme registry; stub to keep tests hermetic.
vi.mock('./themes', () => ({
  resolveTheme: (pt: unknown, st: unknown) => ({ pt, st }),
  previewThemeSalt: () => 'salt',
}));

// The Zustand store — captureAllSnapshots drives selection through it.
const storeState = {
  currentSlideIndex: 3,
  selectedObject: { type: 'element', id: 'orig-sel' } as unknown,
  selectObject: vi.fn(),
  selectSlide: vi.fn(),
};
vi.mock('../store/presentation', () => ({
  usePresentationStore: { getState: () => storeState },
}));

import { planSnapshotCapture, captureAllSnapshots } from './snapshotAll';
import type { LiveEntry } from './snapshotAll';
import { clearPreview, loadPreviewDataUrl, isPreviewThemeStale } from './previewCache';

const mLoad = vi.mocked(loadPreviewDataUrl);
const mStale = vi.mocked(isPreviewThemeStale);
const mClear = vi.mocked(clearPreview);

// --- helpers to build a Presentation -------------------------------------
type El = { id: string; type: string; syncId?: string };
const el = (id: string, type: string, syncId?: string): El => ({ id, type, syncId });
const slide = (elements: El[], theme?: string) => ({ elements, theme });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pres = (slides: any[], theme = 'light') => ({ theme, slides }) as any;

// =========================================================================
describe('planSnapshotCapture (pure decision)', () => {
  const E = (slideIdx: number, present: boolean, themeStale = false): LiveEntry => ({
    slideIdx,
    present,
    themeStale,
  });

  it('captures nothing when every element is present and fresh (idempotency)', () => {
    const out = planSnapshotCapture([E(0, true), E(1, true), E(2, true)], false);
    expect(out).toEqual({ slidesToVisit: [], captured: 0 });
  });

  it('captures the missing (not-present) elements', () => {
    const out = planSnapshotCapture([E(0, true), E(1, false), E(2, false)], false);
    expect(out.captured).toBe(2);
    expect(out.slidesToVisit).toEqual([1, 2]);
  });

  it('captures theme-stale elements even when present', () => {
    const out = planSnapshotCapture([E(0, true, true), E(1, true, false)], false);
    expect(out.captured).toBe(1);
    expect(out.slidesToVisit).toEqual([0]);
  });

  it('force captures everything regardless of present/stale', () => {
    const out = planSnapshotCapture([E(0, true), E(2, true, false)], true);
    expect(out.captured).toBe(2);
    expect(out.slidesToVisit).toEqual([0, 2]);
  });

  it('dedupes slide indices when several needy elements share a slide', () => {
    const out = planSnapshotCapture([E(5, false), E(5, false), E(5, false)], false);
    expect(out.captured).toBe(3);
    expect(out.slidesToVisit).toEqual([5]);
  });

  it('sorts the visited slide indices ascending', () => {
    const out = planSnapshotCapture([E(9, false), E(1, false), E(4, false)], false);
    expect(out.slidesToVisit).toEqual([1, 4, 9]);
  });

  it('handles an empty entry list', () => {
    expect(planSnapshotCapture([], false)).toEqual({ slidesToVisit: [], captured: 0 });
    expect(planSnapshotCapture([], true)).toEqual({ slidesToVisit: [], captured: 0 });
  });

  it('counts captured per-element but visits per-slide (mixed present on one slide)', () => {
    // slide 2 has one missing + one present element → captured counts only the
    // needy one, but the slide is visited once.
    const out = planSnapshotCapture([E(2, false), E(2, true), E(3, false)], false);
    expect(out.captured).toBe(2);
    expect(out.slidesToVisit).toEqual([2, 3]);
  });
});

// =========================================================================
describe('captureAllSnapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mLoad.mockReset().mockResolvedValue(null);
    mStale.mockReset().mockResolvedValue(false);
    mClear.mockReset().mockResolvedValue(undefined);
    storeState.currentSlideIndex = 3;
    storeState.selectedObject = { type: 'element', id: 'orig-sel' };
    storeState.selectObject.mockReset();
    storeState.selectSlide.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Drive an async fn that awaits setTimeout under fake timers to completion.
  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return p;
  }

  it('returns all-zero and touches nothing when the deck has no live elements', async () => {
    const p = pres([slide([el('t1', 'text'), el('i1', 'image')]), slide([el('a1', 'arrow')])]);
    const res = await run(captureAllSnapshots(p));
    expect(res).toEqual({ slidesVisited: 0, captured: 0, totalLive: 0 });
    expect(storeState.selectSlide).not.toHaveBeenCalled();
    expect(mLoad).not.toHaveBeenCalled();
  });

  it('recognizes all four live element types', async () => {
    // none present → all captured; totalLive should be 4
    const p = pres([
      slide([el('d', 'demo')]),
      slide([el('dp', 'demo-piece')]),
      slide([el('v', 'video')]),
      slide([el('n', 'notebook')]),
    ]);
    const res = await run(captureAllSnapshots(p));
    expect(res.totalLive).toBe(4);
    expect(res.captured).toBe(4);
    expect(res.slidesVisited).toBe(4);
  });

  it('generate-missing: visits 0 slides when every live element is already present & fresh', async () => {
    mLoad.mockResolvedValue('data:image/png;base64,AAAA');
    mStale.mockResolvedValue(false);
    const p = pres([slide([el('d', 'demo')]), slide([el('n', 'notebook')])]);
    const res = await run(captureAllSnapshots(p));
    expect(res).toEqual({ slidesVisited: 0, captured: 0, totalLive: 2 });
    expect(storeState.selectSlide).not.toHaveBeenCalled();
    expect(mClear).not.toHaveBeenCalled();
  });

  it('generate-missing: visits only slides with a missing element', async () => {
    // slide 0 demo missing, slide 1 notebook present+fresh, slide 2 video missing
    mLoad.mockImplementation(async (key: string) => (key === 'nbk' ? 'data:x' : null));
    const p = pres([
      slide([el('dmo', 'demo')]),
      slide([el('nbk', 'notebook')]),
      slide([el('vid', 'video')]),
    ]);
    const res = await run(captureAllSnapshots(p));
    expect(res.totalLive).toBe(3);
    expect(res.captured).toBe(2);
    expect(res.slidesVisited).toBe(2);
    // visited slide 0 and slide 2 (ascending), not slide 1
    const visited = storeState.selectSlide.mock.calls.map((c) => c[0]);
    expect(visited).toContain(0);
    expect(visited).toContain(2);
    expect(visited).not.toContain(1);
  });

  it('theme-stale present element is captured (generate-missing)', async () => {
    mLoad.mockResolvedValue('data:present');
    mStale.mockResolvedValue(true);
    const p = pres([slide([el('d', 'demo')])]);
    const res = await run(captureAllSnapshots(p));
    expect(res.captured).toBe(1);
    expect(res.slidesVisited).toBe(1);
    // present, so staleness was actually queried
    expect(mStale).toHaveBeenCalled();
  });

  it('does NOT query theme staleness for an absent preview', async () => {
    mLoad.mockResolvedValue(null);
    const p = pres([slide([el('d', 'demo')])]);
    await run(captureAllSnapshots(p));
    expect(mStale).not.toHaveBeenCalled();
  });

  it('force (Refresh All) clears every live preview first and captures all', async () => {
    // even though everything reports present, force clears + recaptures all.
    mLoad.mockResolvedValue('data:present');
    mStale.mockResolvedValue(false);
    const p = pres([slide([el('d', 'demo'), el('n', 'notebook')]), slide([el('v', 'video')])]);
    const res = await run(captureAllSnapshots(p, { force: true }));
    expect(mClear).toHaveBeenCalledTimes(3);
    expect(res.captured).toBe(3);
    expect(res.totalLive).toBe(3);
    expect(res.slidesVisited).toBe(2);
  });

  it('uses the element sync identity (syncId) as the preview key', async () => {
    const p = pres([slide([el('elem-id', 'demo', 'shared-sync')])]);
    await run(captureAllSnapshots(p, { force: true }));
    expect(mClear).toHaveBeenCalledWith('shared-sync');
    // loadPreviewDataUrl is called with the same key during status resolution
    expect(mLoad).toHaveBeenCalledWith('shared-sync');
  });

  it('reports progress once per visited slide, 1-indexed against the total', async () => {
    const onProgress = vi.fn();
    const p = pres([slide([el('a', 'demo')]), slide([el('b', 'video')]), slide([el('c', 'notebook')])]);
    await run(captureAllSnapshots(p, { onProgress }));
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, { current: 1, total: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { current: 2, total: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(3, { current: 3, total: 3 });
  });

  it('restores the original slide index and selection afterward', async () => {
    storeState.currentSlideIndex = 2;
    storeState.selectedObject = { type: 'element', id: 'keep-me' };
    const p = pres([slide([el('a', 'demo')]), slide([el('b', 'video')])]);
    await run(captureAllSnapshots(p));
    // first selects the slide meta, last two selectSlide calls end on original idx
    const slideCalls = storeState.selectSlide.mock.calls.map((c) => c[0]);
    expect(slideCalls[slideCalls.length - 1]).toBe(2);
    // selectObject called first with {type:'slide'} then restored to original
    expect(storeState.selectObject).toHaveBeenCalledWith({ type: 'slide' });
    expect(storeState.selectObject).toHaveBeenLastCalledWith({ type: 'element', id: 'keep-me' });
  });

  it('restores selection even if the store throws mid-walk (finally path)', async () => {
    storeState.currentSlideIndex = 1;
    storeState.selectedObject = { type: 'slide' };
    // Make the first per-slide selectSlide throw; the initial selectObject and
    // the finally-block restores must still run.
    let call = 0;
    storeState.selectSlide.mockImplementation(() => {
      call++;
      if (call === 1) throw new Error('boom');
    });
    const p = pres([slide([el('a', 'demo')])]);
    const promise = captureAllSnapshots(p);
    const assertion = expect(promise).rejects.toThrow('boom'); // attach handler synchronously
    await vi.runAllTimersAsync();
    await assertion;
    // finally restored the original index despite the throw
    expect(storeState.selectSlide).toHaveBeenLastCalledWith(1);
    expect(storeState.selectObject).toHaveBeenLastCalledWith({ type: 'slide' });
  });

  it('ignores non-live element types when collecting live elements', async () => {
    const p = pres([
      slide([el('t', 'text'), el('img', 'image'), el('d', 'demo')]),
      slide([el('arr', 'arrow'), el('cov', 'cover')]),
    ]);
    const res = await run(captureAllSnapshots(p));
    expect(res.totalLive).toBe(1);
    expect(res.captured).toBe(1);
    expect(res.slidesVisited).toBe(1);
  });
});
