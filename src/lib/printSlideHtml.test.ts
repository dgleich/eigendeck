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

  it('non-scaled html: iframe in CSS px scaled DOWN to the inch box (content not oversized) (#137)', () => {
    // The content is authored in slide-px == CSS-px; print positions in inches with
    // no slide transform, so the iframe (96 CSS-px/in) must be sized at the box's
    // slide-px and scaled by S*96 ≈ 0.55, or the content prints ~1.8x too big.
    const slide = {
      id: 's1', layout: 'default', notes: '',
      elements: [{ id: 'h1', type: 'html', html: '<h1>Hi</h1>',
        position: { x: 192, y: 108, width: 384, height: 216 } }],
    } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide] } as unknown as Presentation;
    const out = buildPrintSlideHtml(slide, presentation, new Map(), new Map());
    expect(out).toContain('sandbox=""');
    expect(out).toContain('&lt;h1&gt;Hi&lt;/h1&gt;');
    expect(out).not.toContain('allow-scripts');
    expect(out).toContain('width:384px;height:216px;');   // iframe at the box's SLIDE-px size (CSS px)
    expect(out).toMatch(/scale\(0\.5/);                    // shrunk by S*96 to the inch box
    expect(out).toContain('in;overflow:hidden;');          // the wrapper box is inch-based
  });

  it('scale-mode html: iframe sized in CSS px (not inches) so content is not clipped (#137)', () => {
    // The iframe content is authored in CSS px. The print box is in inches, and a
    // slide-px is only S*96 CSS px there — so the frame must be sized in CSS px
    // (design size) and scaled DOWN, not sized in inches (which shrank its px
    // canvas ~2× and clipped). Regression guard for the print scaleMode bug.
    const slide = {
      id: 's1', layout: 'default', notes: '',
      elements: [{ id: 'h1', type: 'html', html: '<h1>Hi</h1>', scaleMode: true, scaleW: 200, scaleH: 100,
        position: { x: 0, y: 0, width: 400, height: 100 } }],
    } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide] } as unknown as Presentation;
    const out = buildPrintSlideHtml(slide, presentation, new Map(), new Map());
    expect(out).toContain('overflow:hidden;');                 // clipping wrapper
    expect(out).toContain('width:200px;height:100px;');        // frame at DESIGN size in CSS px (the fix)
    expect(out).not.toContain('scale(1);');                    // scaled down for the inch box, not 1:1
    expect(out).toMatch(/scale\(0\.5/);                        // ~0.55 = 1 slide-px is S*96 CSS px
    expect(out).toContain('transform-origin:top left;');
    expect(out).toContain('in;overflow:hidden;');              // the WRAPPER box is still inch-based
    expect(out).toContain('sandbox=""');                       // still locked
    expect(out).not.toContain('allow-scripts');
  });

  it('renders a curved arrow as an SVG <path> in the print/PDF path (#129)', () => {
    const slide = {
      id: 's1', layout: 'default', notes: '',
      elements: [{ id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520,
        color: '#2563eb', strokeWidth: 4, headSize: 16, heads: 'end',
        c1x: 200, c1y: 620, c2x: 300, c2y: 620, position: { x: 0, y: 0, width: 0, height: 0 } }],
    } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide] } as unknown as Presentation;
    const out = buildPrintSlideHtml(slide, presentation, new Map(), new Map());
    expect(out).toContain('<path d="M 100 500 C 200 620 300 620');
    expect(out).toContain('fill="none"');
  });

  it('uses pre-rendered math HTML for a text element when provided (#print-math)', () => {
    const slide = {
      id: 's1', layout: 'default', notes: '',
      elements: [{ id: 'm1', type: 'text', preset: 'body', html: 'x = $\\alpha$', position: { x: 0, y: 0, width: 100, height: 50 } }],
    } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide] } as unknown as Presentation;
    // The caller (printToPdf) pre-renders math to inline SVG and passes it in,
    // keyed by `${slide.id}:${el.id}`.
    const mathHtmlByKey = new Map([['s1:m1', 'x = <svg data-math="alpha"></svg>']]);
    const out = buildPrintSlideHtml(slide, presentation, new Map(), new Map(), mathHtmlByKey);
    expect(out).toContain('<svg data-math="alpha"></svg>'); // rendered math, not raw $\alpha$
    expect(out).not.toContain('$\\alpha$');
  });

  it('keys math by slide+element so one shared element renders per-slide fonts (regression)', () => {
    // The SAME element id appears on two slides with different fonts (the
    // font-showcase pattern). Keying by el.id alone collided → both slides got
    // one font's math. Composite key must keep them distinct.
    const el = { id: 'shared', type: 'text', preset: 'body', html: '$\\alpha$', position: { x: 0, y: 0, width: 100, height: 50 } };
    const sA = { id: 'sA', layout: 'default', notes: '', elements: [el] } as unknown as Slide;
    const sB = { id: 'sB', layout: 'default', notes: '', elements: [el] } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [sA, sB] } as unknown as Presentation;
    const mathHtmlByKey = new Map([
      ['sA:shared', '<svg data-font="ptsans"></svg>'],
      ['sB:shared', '<svg data-font="libertinus"></svg>'],
    ]);
    expect(buildPrintSlideHtml(sA, presentation, new Map(), new Map(), mathHtmlByKey)).toContain('data-font="ptsans"');
    expect(buildPrintSlideHtml(sB, presentation, new Map(), new Map(), mathHtmlByKey)).toContain('data-font="libertinus"');
  });

  // The slide footer (author·venue + number) must STAY IN the print export and
  // stay consistent with the HTML export — printed decks were missing it entirely.
  it('emits the slide footer (author·venue + number) when given a slide number', () => {
    const slide = { id: 's1', layout: 'default', notes: '', elements: [] } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080, author: 'A. Gleich', venue: 'POPL' }, slides: [slide] } as unknown as Presentation;
    const out = buildPrintSlideHtml(slide, presentation, new Map(), new Map(), undefined, 7);
    expect(out).toContain('A. Gleich · POPL'); // meta (author · venue)
    expect(out).toMatch(/>7<\/span>/);          // slide number
  });

  it('omits the footer when there is no meta and no number', () => {
    const slide = { id: 's1', layout: 'default', notes: '', elements: [] } as unknown as Slide;
    const presentation = { title: 'T', theme: 'white', config: { width: 1920, height: 1080 }, slides: [slide] } as unknown as Presentation;
    expect(buildPrintSlideHtml(slide, presentation, new Map(), new Map())).not.toContain('slide-footer-meta');
    // (no author/venue, no number → nothing to show)
  });
});
