import { describe, it, expect } from 'vitest';
import { buildPrintSlideHtml } from './printSlideHtml';
import type { Presentation, Slide } from '../types/presentation';

// @simplify-guard — render-snapshot net for buildPrintSlideHtml (the print/PDF
// per-slide HTML builder, render-path gate #6). Extracted from App.tsx's
// printToPdf to make that path a pure, gated seam. Pins the HTML-in-inches
// output (and the print-target divergences: smaller image shadow, inch-based
// radius, #2563eb arrow default) before this target is migrated onto the unified
// element-descriptor path. Safe to prune once the unified renderer is trusted.
function fixture(): { slide: Slide; presentation: Presentation } {
  const slide = {
    id: 's1', theme: undefined, layout: 'default', notes: '',
    elements: [
      { id: 't1', type: 'text', preset: 'title', html: 'Title <b>x</b>', position: { x: 60, y: 40, width: 800, height: 120 } },
      { id: 't2', type: 'text', preset: 'body', html: 'Body', verticalAlign: 'middle', position: { x: 60, y: 200, width: 800, height: 200 } },
      // styled text box — exercises background / box-shadow / border-radius +
      // custom padding in the print path (previously dropped).
      { id: 't3', type: 'text', preset: 'body', html: 'Styled', backgroundColor: '#eef3fb', backgroundOpacity: 0.8, boxShadow: true, borderRadius: 16, padding: { top: 10, right: 24, bottom: 10, left: 24 }, position: { x: 900, y: 200, width: 400, height: 200 } },
      { id: 'i1', type: 'image', assetId: 'A', shadow: true, borderRadius: 12, opacity: 0.5, rotation: 5, position: { x: 60, y: 420, width: 300, height: 200 } },
      { id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } },
      { id: 'c1', type: 'cover', color: '#222', position: { x: 1200, y: 500, width: 300, height: 200 } },
      { id: 'd1', type: 'demo', src: 'd.html', position: { x: 400, y: 200, width: 300, height: 200 } },
      { id: 'n1', type: 'notebook', assetId: 'N', position: { x: 800, y: 200, width: 300, height: 200 } },
    ],
  } as unknown as Slide;
  const presentation = {
    title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide],
  } as unknown as Presentation;
  return { slide, presentation };
}

describe('[simplify-guard] buildPrintSlideHtml render snapshot', () => {
  it('renders the static + baked-live element types to stable inches-HTML', () => {
    const { slide, presentation } = fixture();
    const imageCache = new Map([['A', 'data:image/png;base64,IMG']]);
    // d1 has a baked screenshot; n1 does NOT → exercises the label fallback.
    const demoScreenshots = new Map([['s1:d1', 'data:image/png;base64,DEMO']]);
    expect(buildPrintSlideHtml(slide, presentation, imageCache, demoScreenshots)).toMatchSnapshot();
  });
});
