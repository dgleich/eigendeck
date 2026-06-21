/**
 * Enforcement test for the export CONTRACT (docs/export-architecture.md):
 * every SlideElement type MUST render to a non-empty fragment in Path A
 * (buildExportHtml). A future element type added without a `case` in
 * exportCore.mjs's `switch (el.type)` fails here — killing the "silently
 * dropped from export" bug class.
 *
 * KEEP THE LIST BELOW IN SYNC with the `SlideElement` union in
 * src/types/presentation.ts. If you add a type there, add a slide for it here
 * (and a `case` in exportCore.mjs / a branch in App.tsx printToPdf).
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from './exportCore.mjs';
import type { Presentation, SlideElement } from '../types/presentation';

// One slide per element type, each tagged so we can find its slide div by
// data-index and assert that slide rendered something for the element.
const ELEMENT_FIXTURES: Record<string, SlideElement> = {
  text: {
    id: 'el-text', type: 'text', preset: 'body', html: 'Hello world',
    position: { x: 10, y: 10, width: 400, height: 100 },
  },
  'image-raster': {
    id: 'el-img-raster', type: 'image', assetId: 'a-raster', src: 'images/x.png',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  'image-svg': {
    id: 'el-img-svg', type: 'image', assetId: 'a-svg', kind: 'svg', src: 'images/x.svg',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  'image-pdf': {
    id: 'el-img-pdf', type: 'image', assetId: 'a-pdf', kind: 'pdf', src: 'images/x.pdf',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  demo: {
    id: 'el-demo', type: 'demo', assetId: 'a-demo', src: 'demos/d.html',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  'demo-piece': {
    id: 'el-piece', type: 'demo-piece', assetId: 'a-piece', piece: 'graph', demoSrc: 'demos/d.html',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  notebook: {
    id: 'el-nb', type: 'notebook', assetId: 'a-nb',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  video: {
    id: 'el-video', type: 'video', kind: 'embed', provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    position: { x: 10, y: 10, width: 400, height: 300 },
  } as unknown as SlideElement,
  cover: {
    id: 'el-cover', type: 'cover', color: '#123456',
    position: { x: 10, y: 10, width: 400, height: 300 },
  },
  arrow: {
    id: 'el-arrow', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100,
    position: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as SlideElement,
};

function makePresentation(): Presentation {
  return {
    title: 'Contract',
    theme: 'white',
    slides: Object.values(ELEMENT_FIXTURES).map((el) => ({
      id: `slide-${el.id}`, elements: [el], notes: '',
    })),
    config: {
      transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080,
    },
  };
}

// Stubs: assets resolve to tiny byte/text payloads; previews return a 1px PNG.
const ONE_PX_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function build(): Promise<string> {
  return buildExportHtml({
    presentation: makePresentation(),
    readFile: async () => new Uint8Array([1, 2, 3, 4]),
    readTextFile: async () => '<html><head></head><body>demo</body></html>',
    getElementPreview: async () => ONE_PX_PNG,
    // No renderTextElement → exercises the legacy inline-HTML text path.
  });
}

/** Extract the inner HTML of the slide div at the given data-index. */
function sliceSlide(html: string, index: number): string {
  const start = html.indexOf(`<div class="slide" data-index="${index}"`);
  expect(start, `slide ${index} present`).toBeGreaterThanOrEqual(0);
  const after = html.indexOf('>', start) + 1;
  // Slides are siblings; the next slide div (or nav-bar) terminates this one.
  const next = html.indexOf('<div class="slide" data-index="', after);
  const end = next === -1 ? html.indexOf('<!-- eigendeck-source', after) : next;
  return html.slice(after, end === -1 ? undefined : end);
}

describe('buildExportHtml contract — every element type renders', () => {
  const types = Object.keys(ELEMENT_FIXTURES);

  it('keeps the fixture list in sync with the SlideElement union', () => {
    // Bare reminder: the union has 8 type tags (text/image/arrow/demo/
    // demo-piece/cover/notebook/video). We split image into raster/svg/pdf,
    // so 10 fixtures cover 8 tags.
    const tags = new Set(Object.values(ELEMENT_FIXTURES).map((e) => e.type));
    expect([...tags].sort()).toEqual(
      ['arrow', 'cover', 'demo', 'demo-piece', 'image', 'notebook', 'text', 'video'],
    );
  });

  it.each(types)('renders a non-empty fragment for %s', async (key) => {
    const html = await build();
    const index = types.indexOf(key);
    const slideInner = sliceSlide(html, index);
    // Strip the footer (every slide has one) so we test the ELEMENT's output.
    const withoutFooter = slideInner.replace(/<div class="slide-footer">[\s\S]*?<\/div><\/div>/g, '')
      .replace(/<div class="slide-footer">[\s\S]*?<\/span><\/div>/g, '');
    expect(withoutFooter.replace(/\s/g, '').length, `${key} emitted markup`).toBeGreaterThan(0);
  });

  it('pdf image uses the rasterized preview PNG, not raw pdf bytes', async () => {
    const html = await build();
    const inner = sliceSlide(html, types.indexOf('image-pdf'));
    expect(inner).toContain('data:image/png;base64');
    expect(inner).not.toContain('data:image/pdf');
    expect(inner).not.toContain('data:application/pdf');
  });

  it('pdf image with NO preview emits a placeholder, never raw pdf bytes', async () => {
    // Cold export: no getElementPreview (or it misses). Must not ship a
    // data:image/pdf / data:application/pdf in <img> (renders blank).
    const html = await buildExportHtml({
      presentation: makePresentation(),
      readFile: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
      readTextFile: async () => '',
    });
    const inner = sliceSlide(html, types.indexOf('image-pdf'));
    expect(inner).not.toContain('data:image/pdf');
    expect(inner).not.toContain('data:application/pdf');
    expect(inner).toContain('>PDF</div>');
  });

  it('notebook renders the preview PNG', async () => {
    const html = await build();
    const inner = sliceSlide(html, types.indexOf('notebook'));
    expect(inner).toContain('data:image/png;base64');
  });

  it('video embed renders a provider iframe', async () => {
    const html = await build();
    const inner = sliceSlide(html, types.indexOf('video'));
    expect(inner).toContain('<iframe');
    expect(inner).toContain('youtube');
  });
});

describe('buildExportHtml — theme backgrounds (P0-1 / P1-5)', () => {
  it('emits the per-slide theme background on the .slide wrapper', async () => {
    const pres = makePresentation();
    pres.slides[0].theme = 'dark';
    const html = await buildExportHtml({
      presentation: pres,
      readFile: async () => new Uint8Array([1]),
      readTextFile: async () => '<html></html>',
      getElementPreview: async () => ONE_PX_PNG,
    });
    expect(html).toContain('data-index="0" style="background:#1a1a2e;"');
    // The CSS must NOT force white on the .slide rule.
    expect(html).not.toMatch(/\.slide\s*\{[^}]*background:\s*#fff/);
  });

  it('color-less cover falls back to the theme background', async () => {
    const pres: Presentation = {
      title: 'cover', theme: 'black',
      slides: [{
        id: 's', notes: '',
        elements: [{ id: 'c', type: 'cover', position: { x: 0, y: 0, width: 100, height: 100 } }],
      }],
      config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
    };
    const html = await buildExportHtml({
      presentation: pres,
      readFile: async () => new Uint8Array([1]),
      readTextFile: async () => '',
    });
    const inner = html.slice(html.indexOf('data-index="0"'));
    expect(inner).toContain('background:#000000');
  });
});

describe('buildExportHtml — no MathJax CDN', () => {
  it('never injects a MathJax CDN; ships $tex$ verbatim on a cold cache miss', async () => {
    const pres: Presentation = {
      title: 'math', theme: 'white',
      slides: [{
        id: 's', notes: '',
        elements: [{
          id: 't', type: 'text', preset: 'body', html: 'Euler: $e^{i\\pi}+1=0$',
          position: { x: 0, y: 0, width: 800, height: 100 },
        }],
      }],
      config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
    };
    // renderMath returns the source unchanged on a "miss" without throwing —
    // the cold-export scenario. Exports stay self-contained SVG: no CDN, no
    // MathJax runtime. The unresolved source just ships as-is (honest, rare).
    const html = await buildExportHtml({
      presentation: pres,
      readFile: async () => new Uint8Array([1]),
      readTextFile: async () => '',
      renderMath: async (h: string) => h,
    });
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toContain('jsdelivr');
    expect(html).toContain('e^{i\\pi}+1=0'); // source preserved, not dropped
  });
});
