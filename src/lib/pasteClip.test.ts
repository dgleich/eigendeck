import { describe, it, expect, beforeEach } from 'vitest';
import { usePresentationStore } from '../store/presentation';
import { createDefaultPresentation } from '../types/presentation';
import type { Presentation, SlideElement } from '../types/presentation';
import { pasteInternalClip, linkPastedToSource } from './pasteClip';

const el = (id: string, over: Partial<SlideElement> = {}): SlideElement => ({
  id, type: 'text', preset: 'body', html: 'hi',
  position: { x: 10, y: 20, width: 300, height: 100 }, ...over,
} as SlideElement);

/** Seed a 2-slide deck: slide s0 has element e0; slide s1 is empty. */
function seed(currentSlideIndex: number) {
  const p: Presentation = {
    ...createDefaultPresentation(),
    slides: [
      { id: 's0', notes: '', elements: [el('e0')] },
      { id: 's1', notes: '', elements: [] },
    ],
  };
  usePresentationStore.setState({
    presentation: p, currentSlideIndex,
    isPresenting: false, isDirty: false, projectPath: null,
    selectedObject: { type: 'slide' }, showProperties: true,
  });
}

const slide = (i: number) => usePresentationStore.getState().presentation.slides[i];

describe('pasteInternalClip', () => {
  beforeEach(() => seed(1));

  it('pastes an element onto the CURRENT slide with a fresh id', () => {
    pasteInternalClip({ v: 1, kind: 'elements', elements: [el('e0')], fromSlideId: 's0', fromSlideIndex: 0 });
    const els = slide(1).elements;
    expect(els).toHaveLength(1);
    expect(els[0].id).not.toBe('e0');           // fresh id
    expect((els[0] as { html?: string }).html).toBe('hi');
  });

  it('CROSS-slide paste creates an animation link (shared linkId with the source)', () => {
    pasteInternalClip({ v: 1, kind: 'elements', elements: [slide(0).elements[0]], fromSlideId: 's0', fromSlideIndex: 0 });
    const pasted = slide(1).elements[0];
    const src = slide(0).elements[0];
    expect(pasted.linkId).toBeTruthy();
    expect(pasted.linkId).toBe(src.linkId);      // both endpoints share it
  });

  it('SAME-slide paste is an independent copy (offset, NO link)', () => {
    seed(0); // paste back onto slide 0 (the source slide)
    pasteInternalClip({ v: 1, kind: 'elements', elements: [slide(0).elements[0]], fromSlideId: 's0', fromSlideIndex: 0 });
    const els = slide(0).elements;
    expect(els).toHaveLength(2);
    const copy = els[1];
    expect(copy.id).not.toBe('e0');
    expect(copy.linkId).toBeFalsy();             // same-slide → no link
    expect(copy.position.x).toBe(50);            // offset by 40 from x=10
  });

  it('multi-element paste adds all of them', () => {
    seed(1);
    usePresentationStore.setState((s) => ({
      presentation: { ...s.presentation, slides: s.presentation.slides.map((sl, i) =>
        i === 0 ? { ...sl, elements: [el('e0'), el('e1', { html: 'two' })] } : sl) },
    }));
    pasteInternalClip({ v: 1, kind: 'elements', elements: slide(0).elements, fromSlideId: 's0', fromSlideIndex: 0 });
    expect(slide(1).elements).toHaveLength(2);
  });

  it('slide clip pastes the COPIED slide as a new INDEPENDENT slide (fresh ids), not a duplicate of the current', () => {
    const before = usePresentationStore.getState().presentation.slides.length;
    const copied = slide(0); // s0 carries element e0 (html 'hi'); current slide is s1 (empty)
    pasteInternalClip({ v: 1, kind: 'slide', slide: copied, fromSlideId: 's0', fromSlideIndex: 0 });
    const st = usePresentationStore.getState();
    expect(st.presentation.slides.length).toBe(before + 1);
    // Inserted AFTER the current slide (index 1) → new slide at index 2, selected.
    expect(st.currentSlideIndex).toBe(2);
    expect(st.selectedObject).toEqual({ type: 'slide' });
    const pasted = st.presentation.slides[2];
    expect(pasted.id).not.toBe('s0');                           // fresh slide id
    expect(pasted.elements).toHaveLength(1);                    // the COPIED slide's element…
    expect(pasted.elements[0].id).not.toBe('e0');              // …with a fresh element id
    expect((pasted.elements[0] as { html?: string }).html).toBe('hi'); // …and the copied content
    expect(pasted.elements[0].syncId).toBeFalsy();             // independent — no sync group
    expect(pasted.elements[0].linkId).toBeFalsy();             // independent — no animation link
  });

  it('slide clip with a malformed payload is a no-op', () => {
    const before = usePresentationStore.getState().presentation.slides.length;
    pasteInternalClip({ v: 1, kind: 'slide', slide: undefined, fromSlideId: 's0', fromSlideIndex: 0 });
    expect(usePresentationStore.getState().presentation.slides.length).toBe(before);
  });
});

describe('linkPastedToSource', () => {
  beforeEach(() => seed(1));

  it('links a pasted element to an existing source', () => {
    const pasted = el('p1');
    usePresentationStore.getState().addElement(pasted); // onto current slide (1)
    linkPastedToSource('p1', 's0', 'e0');
    expect(slide(1).elements.find((e) => e.id === 'p1')?.linkId).toBeTruthy();
  });

  it('is a no-op when the source slide/element is gone', () => {
    const pasted = el('p1');
    usePresentationStore.getState().addElement(pasted);
    linkPastedToSource('p1', 'GONE', 'e0');      // no such slide
    expect(slide(1).elements.find((e) => e.id === 'p1')?.linkId).toBeFalsy();
  });
});
