import { describe, it, expect } from 'vitest';
import { computeAssetUsage } from './assetUsage';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

// Tiny element factories — only the fields computeAssetUsage looks at
// matter. Type cast via `as` because the real ImageElement requires
// more fields (position, etc.) we don't care about here.
function image(opts: { id?: string; assetId?: string; src?: string } = {}): SlideElement {
  return {
    id: opts.id ?? 'el-' + Math.random().toString(36).slice(2),
    type: 'image',
    src: opts.src ?? 'images/x.png',
    assetId: opts.assetId,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as SlideElement;
}

function demo(opts: { id?: string; assetId?: string; src?: string } = {}): SlideElement {
  return {
    id: opts.id ?? 'el-' + Math.random().toString(36).slice(2),
    type: 'demo',
    src: opts.src ?? 'demos/x.html',
    assetId: opts.assetId,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as SlideElement;
}

function demoPiece(opts: { id?: string; assetId?: string; demoSrc?: string } = {}): SlideElement {
  return {
    id: opts.id ?? 'el-' + Math.random().toString(36).slice(2),
    type: 'demo-piece',
    demoSrc: opts.demoSrc ?? 'demos/x.html',
    piece: 'piece-1',
    assetId: opts.assetId,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as SlideElement;
}

function textEl(): SlideElement {
  return {
    id: 'el-text-' + Math.random().toString(36).slice(2),
    type: 'text',
    preset: 'body',
    html: 'hello',
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as SlideElement;
}

function slide(elements: SlideElement[], id = 'slide-' + Math.random().toString(36).slice(2)): Slide {
  return { id, elements, notes: '' };
}

function pres(slides: Slide[]): Presentation {
  return {
    title: 'Test',
    theme: 'white',
    slides,
    config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
  };
}

describe('computeAssetUsage', () => {
  // The four label-case scenarios from AssetSection.usageLabel.

  it('returns zeros for empty/null presentation', () => {
    expect(computeAssetUsage(null, 'A', 'p')).toEqual({ elementCount: 0, slideCount: 0, slideNumbers: [] });
    expect(computeAssetUsage(undefined, 'A', 'p')).toEqual({ elementCount: 0, slideCount: 0, slideNumbers: [] });
  });

  it('1 copy on 1 slide → 1/1', () => {
    const p = pres([slide([image({ assetId: 'A' })])]);
    const u = computeAssetUsage(p, 'A', 'images/x.png');
    expect(u.elementCount).toBe(1);
    expect(u.slideCount).toBe(1);
    expect(u.slideNumbers).toEqual([1]);
  });

  it('2 copies on 1 slide → 2/1 (regression: was counting as 2 slides)', () => {
    const p = pres([slide([image({ assetId: 'A' }), image({ assetId: 'A' })])]);
    const u = computeAssetUsage(p, 'A', 'images/x.png');
    expect(u.elementCount).toBe(2);
    expect(u.slideCount).toBe(1);
    expect(u.slideNumbers).toEqual([1]);
  });

  it('1 copy each on 2 slides → 2/2', () => {
    const p = pres([
      slide([image({ assetId: 'A' })]),
      slide([image({ assetId: 'A' })]),
    ]);
    const u = computeAssetUsage(p, 'A', 'images/x.png');
    expect(u.elementCount).toBe(2);
    expect(u.slideCount).toBe(2);
    expect(u.slideNumbers).toEqual([1, 2]);
  });

  it('mixed: 2 copies on slide 1, 1 copy on slide 2 → 3/2', () => {
    const p = pres([
      slide([image({ assetId: 'A' }), image({ assetId: 'A' })]),
      slide([image({ assetId: 'A' })]),
    ]);
    const u = computeAssetUsage(p, 'A', 'images/x.png');
    expect(u.elementCount).toBe(3);
    expect(u.slideCount).toBe(2);
    expect(u.slideNumbers).toEqual([1, 2]);
  });

  it('only counts elements bound to the named asset', () => {
    const p = pres([
      slide([
        image({ assetId: 'A' }),
        image({ assetId: 'B' }),  // different asset; shouldn't count
      ]),
      slide([image({ assetId: 'A' })]),
    ]);
    const u = computeAssetUsage(p, 'A', null);
    expect(u.elementCount).toBe(2);
    expect(u.slideCount).toBe(2);
  });

  it('non-asset elements (text) are ignored', () => {
    const p = pres([slide([image({ assetId: 'A' }), textEl(), textEl()])]);
    const u = computeAssetUsage(p, 'A', 'images/x.png');
    expect(u.elementCount).toBe(1);
  });

  it('falls back to path matching for legacy elements without assetId', () => {
    const p = pres([
      slide([image({ src: 'chart.svg' })]),       // legacy: no assetId
      slide([image({ assetId: 'A', src: 'chart.svg' })]),  // bound by id
    ]);
    const u = computeAssetUsage(p, 'A', 'chart.svg');
    expect(u.elementCount).toBe(2);  // both count
    expect(u.slideCount).toBe(2);
  });

  it('legacy path match does NOT trigger when paths differ', () => {
    const p = pres([slide([image({ src: 'other.svg' })])]);
    const u = computeAssetUsage(p, 'A', 'chart.svg');
    expect(u.elementCount).toBe(0);
  });

  it('demo elements match via src', () => {
    const p = pres([slide([demo({ assetId: 'A' })])]);
    const u = computeAssetUsage(p, 'A', 'demos/x.html');
    expect(u.elementCount).toBe(1);
  });

  it('demo-piece elements match via demoSrc (legacy path fallback)', () => {
    const p = pres([slide([demoPiece({ demoSrc: 'demos/x.html' })])]);
    const u = computeAssetUsage(p, 'A', 'demos/x.html');
    expect(u.elementCount).toBe(1);
  });

  it('slide with no bound elements does NOT inflate slideNumbers', () => {
    const p = pres([
      slide([image({ assetId: 'B' })]),  // unrelated asset
      slide([image({ assetId: 'A' })]),  // bound
      slide([textEl()]),                  // only text
    ]);
    const u = computeAssetUsage(p, 'A', null);
    expect(u.elementCount).toBe(1);
    expect(u.slideCount).toBe(1);
    expect(u.slideNumbers).toEqual([2]);
  });

  it('respects assetId binding even when path also matches another asset (assetId wins)', () => {
    // Element has explicit assetId=A but src points to chart.svg.
    // Asking about asset B with path chart.svg → should NOT match
    // (assetId wins; doesn't fall back to path).
    const p = pres([slide([image({ assetId: 'A', src: 'chart.svg' })])]);
    const u = computeAssetUsage(p, 'B', 'chart.svg');
    expect(u.elementCount).toBe(0);
  });
});
