// Regression tests for present-mode transition planning — locks in the fixes
// for the z-order "jump" and the synced/cover static behavior.
import { describe, it, expect } from 'vitest';
import { planPresentTransition } from './presentTransition';
import type { Slide, SlideElement } from '../types/presentation';

const el = (id: string, type = 'text', linkId?: string): SlideElement =>
  ({ id, type, linkId, position: { x: 0, y: 0, width: 10, height: 10 } } as unknown as SlideElement);
const slide = (id: string, elements: SlideElement[]): Slide =>
  ({ id, elements } as unknown as Slide);

describe('planPresentTransition', () => {
  it('z-index is the TRUE slide z-order for every element, regardless of role', () => {
    // The magnetic-powers regression: a LINKED title (linkId, no match on prev)
    // sat in a high-z bucket above its unlinked image mid-transition, then
    // snapped behind. z must follow array order, not the transition role.
    const prev = slide('p', [el('demo', 'demo')]);
    const cur = slide('c', [
      el('img', 'image'),         // z0 (bottom)
      el('body', 'text'),         // z1
      el('title', 'text', 'LX'),  // z2 (top) — has a linkId, but no match on prev
    ]);
    const { items } = planPresentTransition(prev, cur);
    expect(items.map((i) => [i.element.id, i.z])).toEqual([
      ['img', 0], ['body', 1], ['title', 2],
    ]);
    // The title is "fade" (linkId present but unmatched on prev), yet still z2 —
    // strictly above the image at z0. This is the bug that's now impossible.
    const title = items.find((i) => i.element.id === 'title')!;
    const img = items.find((i) => i.element.id === 'img')!;
    expect(title.role).toBe('fade');
    expect(title.z).toBeGreaterThan(img.z);
  });

  it('z equals the element index for an arbitrary mix', () => {
    const cur = slide('c', [el('a'), el('b', 'image'), el('c', 'cover'), el('d', 'text', 'LZ')]);
    const { items } = planPresentTransition(slide('p', [el('x')]), cur);
    items.forEach((it, i) => expect(it.z).toBe(i));
  });

  it('a linkId matched on the previous slide → linked, with its partner', () => {
    const from = el('a', 'image', 'L1');
    const prev = slide('p', [from]);
    const cur = slide('c', [el('b', 'image', 'L1')]);
    const { items } = planPresentTransition(prev, cur);
    expect(items[0].role).toBe('linked');
    expect(items[0].from?.id).toBe('a');
  });

  it('cover masks are static (instant), never fade', () => {
    const { items } = planPresentTransition(slide('p', [el('x')]), slide('c', [el('cv', 'cover')]));
    expect(items[0].role).toBe('static');
  });

  it('an element carried over from the previous slide (same id) is static — no wiggle', () => {
    // Synced element across build steps: same id on prev + current.
    const prev = slide('p', [el('shared', 'text')]);
    const cur = slide('c', [el('shared', 'text'), el('new', 'text')]);
    const { items } = planPresentTransition(prev, cur);
    expect(items.find((i) => i.element.id === 'shared')!.role).toBe('static');
    expect(items.find((i) => i.element.id === 'new')!.role).toBe('fade');
  });

  it('genuinely new elements fade in', () => {
    const { items } = planPresentTransition(slide('p', [el('old')]), slide('c', [el('fresh')]));
    expect(items[0].role).toBe('fade');
  });

  it('previous-only linked element with no match → fadeOut (with its prev z-order)', () => {
    const prev = slide('p', [el('keep'), el('gone', 'text', 'LG')]);
    const cur = slide('c', [el('keep')]);
    const { items, fadeOut } = planPresentTransition(prev, cur);
    expect(items.map((i) => i.element.id)).toEqual(['keep']);
    expect(fadeOut.map((f) => [f.element.id, f.z])).toEqual([['gone', 1]]);
  });

  it('no previous slide → everything is an item (no fadeOut)', () => {
    const cur = slide('c', [el('a'), el('b', 'cover')]);
    const { items, fadeOut } = planPresentTransition(null, cur);
    expect(fadeOut).toEqual([]);
    expect(items.map((i) => i.role)).toEqual(['fade', 'static']);
    items.forEach((it, i) => expect(it.z).toBe(i));
  });
});
