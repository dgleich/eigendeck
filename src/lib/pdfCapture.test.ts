import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureSlideJpegs } from './pdfCapture';
import { usePresentationStore } from '../store/presentation';
import type { Presentation } from '../types/presentation';

// jsdom can't rasterize (no .slide-canvas is mounted → domToDataUrl is never
// reached), which is fine: this test pins the PROGRESS cadence + slide/selection
// restoration — the part #176 adds — not the pixels. Mock the module so the
// dynamic import resolves cleanly.
vi.mock('modern-screenshot', () => ({ domToDataUrl: vi.fn(async () => 'data:image/png;base64,') }));

function deck(n: number): Presentation {
  return {
    title: 'T', theme: 'white', config: { width: 1920, height: 1080 },
    slides: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, elements: [] })),
  } as unknown as Presentation;
}

describe('captureSlideJpegs (PDF export capture pass, #176)', () => {
  beforeEach(() => { document.body.classList.remove('pdf-capturing'); });

  it('reports per-slide progress (slide 1..N of N), once each in order — drives the busy counter', async () => {
    const presentation = deck(3);
    usePresentationStore.setState({ presentation, currentSlideIndex: 0, selectedObject: { type: 'slide' } } as never);
    const progress: Array<{ current: number; total: number }> = [];
    const imgs = await captureSlideJpegs(presentation, { dwellMs: 0, onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([
      { current: 1, total: 3 }, { current: 2, total: 3 }, { current: 3, total: 3 },
    ]);
    expect(imgs).toHaveLength(3); // one frame per slide (empty bytes in jsdom)
  });

  it('restores the original slide + selection and clears .pdf-capturing when done', async () => {
    const presentation = deck(4);
    usePresentationStore.setState({ presentation, currentSlideIndex: 2, selectedObject: { type: 'element', id: 'x' } } as never);
    await captureSlideJpegs(presentation, { dwellMs: 0 });
    const st = usePresentationStore.getState();
    expect(st.currentSlideIndex).toBe(2);
    expect(st.selectedObject).toEqual({ type: 'element', id: 'x' });
    expect(document.body.classList.contains('pdf-capturing')).toBe(false);
  });

  it('adds .pdf-capturing DURING the capture (so editor chrome is hidden while screenshotting)', async () => {
    const presentation = deck(2);
    usePresentationStore.setState({ presentation, currentSlideIndex: 0, selectedObject: { type: 'slide' } } as never);
    let duringCapture = false;
    await captureSlideJpegs(presentation, {
      dwellMs: 0,
      onProgress: () => { if (document.body.classList.contains('pdf-capturing')) duringCapture = true; },
    });
    expect(duringCapture).toBe(true);
  });

  it('empty deck → no progress, no frames, no lingering capture class', async () => {
    const presentation = deck(0);
    usePresentationStore.setState({ presentation, currentSlideIndex: 0, selectedObject: { type: 'slide' } } as never);
    const progress: unknown[] = [];
    const imgs = await captureSlideJpegs(presentation, { dwellMs: 0, onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([]);
    expect(imgs).toEqual([]);
    expect(document.body.classList.contains('pdf-capturing')).toBe(false);
  });
});
