import { describe, it, expect, beforeEach } from 'vitest';
import { encodeClipHtml, decodeClipHtml } from './clipboardModel';
import { pasteInternalClip } from './pasteClip';
import { usePresentationStore } from '../store/presentation';
import { createDefaultPresentation } from '../types/presentation';
import type { Presentation, SlideElement } from '../types/presentation';

const pos = { x: 10, y: 20, width: 200, height: 100 };

// One representative element per type, each with a DISTINCTIVE field the paste
// must preserve. Adding a new element type without a row here is a visible gap.
const ELEMENTS: Record<string, { el: SlideElement; check: (e: SlideElement) => void }> = {
  text:          { el: { id: 's', type: 'text', preset: 'body', html: 'RT-text', color: '#f00', position: pos } as SlideElement,
                   check: (e) => expect((e as { html?: string }).html).toBe('RT-text') },
  image:         { el: { id: 's', type: 'image', kind: 'raster', assetId: 'RT-img', position: pos } as SlideElement,
                   check: (e) => expect((e as { assetId?: string }).assetId).toBe('RT-img') },
  arrow:         { el: { id: 's', type: 'arrow', x1: 11, y1: 22, x2: 33, y2: 44, color: '#00f', strokeWidth: 3, position: pos } as SlideElement,
                   check: (e) => expect((e as { x1?: number }).x1).toBe(11) },
  cover:         { el: { id: 's', type: 'cover', color: '#123456', position: pos } as SlideElement,
                   check: (e) => expect((e as { color?: string }).color).toBe('#123456') },
  html:          { el: { id: 's', type: 'html', html: '<b>RT-html</b>', position: pos } as SlideElement,
                   check: (e) => expect((e as { html?: string }).html).toBe('<b>RT-html</b>') },
  demo:          { el: { id: 's', type: 'demo', assetId: 'RT-demo', position: pos } as SlideElement,
                   check: (e) => expect((e as { assetId?: string }).assetId).toBe('RT-demo') },
  'demo-piece':  { el: { id: 's', type: 'demo-piece', assetId: 'RT-d', piece: 'RT-piece', position: pos } as SlideElement,
                   check: (e) => expect((e as { piece?: string }).piece).toBe('RT-piece') },
  notebook:      { el: { id: 's', type: 'notebook', assetId: 'RT-nb', position: pos } as SlideElement,
                   check: (e) => expect((e as { assetId?: string }).assetId).toBe('RT-nb') },
  'video-embed': { el: { id: 's', type: 'video', kind: 'embed', src: 'https://youtu.be/RT', position: pos } as SlideElement,
                   check: (e) => expect((e as { src?: string }).src).toBe('https://youtu.be/RT') },
  'video-file':  { el: { id: 's', type: 'video', kind: 'file', assetId: 'RT-vf', position: pos } as SlideElement,
                   check: (e) => expect((e as { assetId?: string }).assetId).toBe('RT-vf') },
};

describe('copy → clipboard → paste round-trip, per element type', () => {
  it.each(Object.entries(ELEMENTS))('codec preserves a %s element exactly', (_name, { el }) => {
    const back = decodeClipHtml(encodeClipHtml({ kind: 'elements', elements: [el], fromSlideId: 's0', fromSlideIndex: 0 }, ''));
    expect(back?.elements?.[0]).toEqual(el);
  });

  describe('pasteInternalClip preserves the element (fresh id + cross-slide link)', () => {
    beforeEach(() => {
      const p: Presentation = {
        ...createDefaultPresentation(),
        slides: [{ id: 's0', notes: '', elements: [] }, { id: 's1', notes: '', elements: [] }],
      };
      usePresentationStore.setState({
        presentation: p, currentSlideIndex: 1, isPresenting: false, isDirty: false,
        projectPath: null, selectedObject: { type: 'slide' }, showProperties: true,
      });
    });

    it.each(Object.entries(ELEMENTS))('%s: pasted onto another slide keeps its fields + gets a fresh id', (_name, { el, check }) => {
      pasteInternalClip({ v: 1, kind: 'elements', elements: [el], fromSlideId: 's0', fromSlideIndex: 0 });
      const els = usePresentationStore.getState().presentation.slides[1].elements;
      expect(els).toHaveLength(1);
      const pasted = els[0];
      expect(pasted.type).toBe(el.type);
      expect(pasted.id).not.toBe('s');   // fresh id
      check(pasted);                      // distinctive field survived
    });
  });
});
