import { describe, it, expect } from 'vitest';
import { buildExportHtml, htmlEscapeForSrcdoc, injectDemoBootstrap, bytesToDataUrl } from './exportCore.mjs';

// Minimal presentation for testing
function makePresentation(overrides = {}) {
  return {
    title: 'Test Presentation',
    theme: 'white',
    slides: [
      {
        id: 'slide-1',
        layout: 'default',
        elements: [
          { id: 'el-title', type: 'text', preset: 'title', html: 'Hello World', position: { x: 80, y: 20, width: 1760, height: 200 } },
          { id: 'el-body', type: 'text', preset: 'body', html: 'Body text with <b>bold</b>', position: { x: 80, y: 215, width: 1760, height: 765 } },
        ],
        notes: 'Speaker notes here',
      },
      {
        id: 'slide-2',
        layout: 'default',
        elements: [
          { id: 'el-img', type: 'image', src: 'data:image/png;base64,iVBOR', position: { x: 100, y: 100, width: 400, height: 300 } },
        ],
        notes: '',
      },
    ],
    config: {
      width: 1920,
      height: 1080,
      author: 'Test Author',
      venue: 'Test Venue',
      transition: 'slide',
      backgroundTransition: 'fade',
    },
    ...overrides,
  };
}

describe('buildExportHtml', () => {
  it('produces valid HTML with all slides', async () => {
    const p = makePresentation();
    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '<html><body>demo</body></html>',
      renderMath: null,
      applyMathPreamble: null,
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Presentation');
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="1"');
    expect(html).toContain('Hello World');
    expect(html).toContain('Body text with <b>bold</b>');
    expect(html).toContain('Test Author');
  });

  it('embeds source JSON for round-trip import', async () => {
    const p = makePresentation();
    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    expect(match).toBeTruthy();
  });

  it('round-trips presentation through export and re-import', async () => {
    const original = makePresentation();
    const html = await buildExportHtml({
      presentation: original,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    // Extract embedded source (same logic as fileOps.ts importFromHtml)
    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    expect(match).toBeTruthy();

    const json = decodeURIComponent(escape(atob(match[1])));
    const restored = JSON.parse(json);

    // Verify structure
    expect(restored.title).toBe(original.title);
    expect(restored.theme).toBe(original.theme);
    expect(restored.slides.length).toBe(original.slides.length);
    expect(restored.config.author).toBe(original.config.author);
    expect(restored.config.venue).toBe(original.config.venue);
    expect(restored.config.width).toBe(1920);
    expect(restored.config.height).toBe(1080);

    // Verify slides
    for (let i = 0; i < original.slides.length; i++) {
      const os = original.slides[i];
      const rs = restored.slides[i];
      expect(rs.id).toBe(os.id);
      expect(rs.layout).toBe(os.layout);
      expect(rs.notes).toBe(os.notes);
      expect(rs.elements.length).toBe(os.elements.length);

      // Verify elements
      for (let j = 0; j < os.elements.length; j++) {
        expect(rs.elements[j].id).toBe(os.elements[j].id);
        expect(rs.elements[j].type).toBe(os.elements[j].type);
        expect(rs.elements[j].position).toEqual(os.elements[j].position);
        if (os.elements[j].html) {
          expect(rs.elements[j].html).toBe(os.elements[j].html);
        }
      }
    }
  });

  it('round-trips presentation with math', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{
          id: 'e1', type: 'text', preset: 'body',
          html: 'The formula $x^2 + y^2 = z^2$ is famous',
          position: { x: 0, y: 0, width: 100, height: 100 },
        }],
      }],
      config: { ...makePresentation().config, mathPreamble: '\\newcommand{\\R}{\\mathbb{R}}' },
    });

    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));

    expect(restored.slides[0].elements[0].html).toContain('$x^2 + y^2 = z^2$');
    expect(restored.config.mathPreamble).toBe('\\newcommand{\\R}{\\mathbb{R}}');
    // Exports are self-contained SVG — never a MathJax CDN/runtime. With no
    // renderMath provided, the unrendered $tex$ ships verbatim (honest), but no
    // network MathJax is pulled in.
    expect(html).not.toContain('mathjax@3');
    expect(html).not.toContain('jsdelivr');
  });

  it('round-trips with demo and demo-piece elements', async () => {
    const demoHtml = '<!DOCTYPE html><html><head></head><body><script>var params = new URLSearchParams(location.hash.slice(1));</script></body></html>';
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [
          { id: 'e1', type: 'demo', src: 'demos/test.html', position: { x: 0, y: 0, width: 800, height: 600 } },
          { id: 'e2', type: 'demo-piece', demoSrc: 'demos/multi.html', piece: 'graph', position: { x: 0, y: 0, width: 400, height: 300 } },
          { id: 'e3', type: 'demo-piece', demoSrc: 'demos/multi.html', piece: 'controls', position: { x: 400, y: 0, width: 400, height: 300 } },
        ],
      }],
    });

    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => demoHtml,
      renderMath: null,
      applyMathPreamble: null,
    });

    // Verify export has iframes
    expect(html).toContain('srcdoc=');
    // Verify postMessage relay is present
    expect(html).toContain('__bc');
    expect(html).toContain('request-state');
    // Verify bootstrap injection
    expect(html).toContain('__hp');
    expect(html).toContain('piece');
    // Verify controller iframe was added
    const controllerCount = (html.match(/role.*controller/g) || []).length;
    expect(controllerCount).toBeGreaterThan(0);

    // Round-trip the source
    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    expect(restored.slides[0].elements.length).toBe(3);
    expect(restored.slides[0].elements[0].type).toBe('demo');
    expect(restored.slides[0].elements[0].src).toBe('demos/test.html');
    expect(restored.slides[0].elements[1].type).toBe('demo-piece');
    expect(restored.slides[0].elements[1].piece).toBe('graph');
    expect(restored.slides[0].elements[2].piece).toBe('controls');
  });

  it('round-trips with arrows and covers', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [
          { id: 'e1', type: 'arrow', x1: 100, y1: 100, x2: 500, y2: 300, color: '#e53e3e', strokeWidth: 4, headSize: 16, position: { x: 100, y: 100, width: 400, height: 200 } },
          { id: 'e2', type: 'cover', color: '#ffffff', position: { x: 0, y: 0, width: 1920, height: 1080 } },
        ],
      }],
    });

    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    expect(restored.slides[0].elements[0].type).toBe('arrow');
    expect(restored.slides[0].elements[0].x1).toBe(100);
    expect(restored.slides[0].elements[1].type).toBe('cover');
  });

  it('round-trips with image effects', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{
          id: 'e1', type: 'image', src: 'data:image/png;base64,abc',
          shadow: true, borderRadius: 12, opacity: 0.8, rotation: 15,
          position: { x: 100, y: 100, width: 400, height: 300 },
        }],
      }],
    });

    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    expect(html).toContain('drop-shadow');
    expect(html).toContain('border-radius:12px');
    expect(html).toContain('opacity:0.8');
    expect(html).toContain('rotate(15deg)');

    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    expect(restored.slides[0].elements[0].shadow).toBe(true);
    expect(restored.slides[0].elements[0].borderRadius).toBe(12);
    expect(restored.slides[0].elements[0].opacity).toBe(0.8);
    expect(restored.slides[0].elements[0].rotation).toBe(15);
  });

  it('round-trips a text element with a rounded background panel', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{
          id: 'e1', type: 'text', preset: 'body', html: 'card',
          backgroundColor: '#eef3fb', borderRadius: 16,
          position: { x: 100, y: 100, width: 400, height: 200 },
        }],
      }],
    });

    const html = await buildExportHtml({
      presentation: p,
      readFile: async () => new Uint8Array([0]),
      readTextFile: async () => '',
      renderMath: null,
      applyMathPreamble: null,
    });

    expect(html).toContain('border-radius:16px');

    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    expect(restored.slides[0].elements[0].borderRadius).toBe(16);
    expect(restored.slides[0].elements[0].backgroundColor).toBe('#eef3fb');
  });

  it('round-trips a text element with per-side padding', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{
          id: 'e1', type: 'text', preset: 'body', html: 'card',
          padding: { top: 24, right: 40, bottom: 24, left: 40 },
          position: { x: 100, y: 100, width: 400, height: 200 },
        }],
      }],
    });
    const html = await buildExportHtml({
      presentation: p, readFile: async () => new Uint8Array([0]), readTextFile: async () => '',
      renderMath: null, applyMathPreamble: null,
    });
    expect(html).toContain('padding:24px 40px 24px 40px');
    const match = html.match(/<!-- eigendeck-source: (.+?) -->/);
    const restored = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    expect(restored.slides[0].elements[0].padding).toEqual({ top: 24, right: 40, bottom: 24, left: 40 });
  });

  it('round-trips a double-headed, semi-transparent arrow (#98)', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{ id: 'a1', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, color: '#2563eb', strokeWidth: 8, headSize: 20, heads: 'both', opacity: 0.5 }],
      }],
    });
    const html = await buildExportHtml({
      presentation: p, readFile: async () => new Uint8Array([0]), readTextFile: async () => '',
      renderMath: null, applyMathPreamble: null,
    });
    expect(html).toContain('<g opacity="0.5">');
    expect((html.match(/<polygon /g) || []).length).toBeGreaterThanOrEqual(2);   // both heads
    // line is pulled back from the tip (no poke-through): x2 < 100
    const m = html.match(/<line x1="([\d.]+)"[^>]*x2="([\d.]+)"/);
    expect(parseFloat(m[2])).toBeLessThan(100);
    const src = JSON.parse(decodeURIComponent(escape(atob(html.match(/<!-- eigendeck-source: (.+?) -->/)[1]))));
    expect(src.slides[0].elements[0].heads).toBe('both');
    expect(src.slides[0].elements[0].opacity).toBe(0.5);
  });
});

describe('htmlEscapeForSrcdoc', () => {
  it('escapes all required characters', () => {
    expect(htmlEscapeForSrcdoc('<div class="test">&')).toBe('&lt;div class=&quot;test&quot;&gt;&amp;');
  });
});

describe('injectDemoBootstrap', () => {
  it('injects bootstrap into <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
    const result = injectDemoBootstrap(html, '#piece=graph', 'slide0-test');
    expect(result).toContain('__ch = "slide0-test"');
    expect(result).toContain('"piece":"graph"');
    expect(result).toContain('<head><script>');
  });

  it('prepends bootstrap if no <head>', () => {
    const html = '<div>no head</div>';
    const result = injectDemoBootstrap(html, '#role=controller', 'key');
    expect(result).toContain('__ch = "key"');
    expect(result).toContain('"role":"controller"');
    expect(result.indexOf('<script>')).toBe(0);
  });

  it('patches URLSearchParams and BroadcastChannel', () => {
    const result = injectDemoBootstrap('<head></head>', '#piece=x', 'k');
    expect(result).toContain('URLSearchParams');
    expect(result).toContain('BroadcastChannel');
    expect(result).toContain('postMessage');
    expect(result).toContain('request-state');
  });
});

describe('bytesToDataUrl', () => {
  it('converts bytes to data URL', () => {
    const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
    const url = bytesToDataUrl(bytes, 'png');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('handles SVG mime type', () => {
    const url = bytesToDataUrl(new Uint8Array([60]), 'svg');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('handles JPG -> JPEG mapping', () => {
    const url = bytesToDataUrl(new Uint8Array([0xFF]), 'jpg');
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe('HTML well-formedness in export', () => {
  function countTag(html, tag) {
    const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    const closes = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    return { opens, closes };
  }

  const exportOpts = {
    readFile: async () => new Uint8Array([0]),
    readTextFile: async () => '<html><body>demo</body></html>',
    renderMath: null,
    applyMathPreamble: null,
  };

  it('export has balanced div tags overall', async () => {
    const p = makePresentation();
    const html = await buildExportHtml({ presentation: p, ...exportOpts });
    const { opens, closes } = countTag(html, 'div');
    expect(opens).toBe(closes);
  });

  it('export with vertical alignment has balanced divs', async () => {
    const p = makePresentation({
      slides: Array.from({ length: 3 }, (_, i) => ({
        id: `s${i}`, layout: 'default', notes: '',
        elements: [
          { id: `t${i}`, type: 'text', preset: 'title', html: `Title ${i}`,
            position: { x: 80, y: 20, width: 1760, height: 200 }, verticalAlign: 'bottom' },
          { id: `b${i}`, type: 'text', preset: 'body', html: `Body ${i}`,
            position: { x: 80, y: 215, width: 1760, height: 765 }, verticalAlign: 'middle' },
        ],
      })),
    });
    const html = await buildExportHtml({ presentation: p, ...exportOpts });
    const { opens, closes } = countTag(html, 'div');
    expect(opens).toBe(closes);
  });

  it('well-formed element HTML stays balanced in export', async () => {
    const p = makePresentation({
      slides: [{
        id: 's1', layout: 'default', notes: '',
        elements: [{
          id: 'e1', type: 'text', preset: 'title',
          html: '<div style="text-align: center;"><b>Centered Title</b></div>',
          position: { x: 80, y: 20, width: 1760, height: 200 },
        }, {
          id: 'e2', type: 'text', preset: 'body',
          html: 'Body must be visible',
          position: { x: 80, y: 215, width: 1760, height: 765 },
        }],
      }],
    });
    const html = await buildExportHtml({ presentation: p, ...exportOpts });
    expect(html).toContain('Centered Title');
    expect(html).toContain('Body must be visible');
    const { opens, closes } = countTag(html, 'div');
    expect(opens).toBe(closes);
  });
});

// @simplify-guard — full-output snapshot over a fixture covering every element
// type. Behavior-preservation net for refactoring/deduping the exportCore render
// path (the biggest render target): the snapshot must stay byte-identical across
// pure simplifications. Safe to prune once the unified renderer is trusted;
// update intentionally only when output SHOULD change.
describe('[simplify-guard] exportCore full-output snapshot (all element types)', () => {
  function everyTypeDeck() {
    return {
      title: 'All Types', theme: 'white',
      config: { width: 1920, height: 1080, author: 'A', venue: 'V', transition: 'slide', backgroundTransition: 'fade' },
      slides: [{
        id: 's1', layout: 'default', notes: 'n',
        elements: [
          { id: 't-title', type: 'text', preset: 'title', html: 'Title', position: { x: 60, y: 40, width: 1800, height: 120 } },
          { id: 't-body', type: 'text', preset: 'body', html: 'Body <b>b</b>', backgroundColor: '#eef3fb', backgroundOpacity: 0.8, padding: { top: 10, right: 12, bottom: 10, left: 12 }, textEffect: 'shadow', boxShadow: true, position: { x: 60, y: 180, width: 900, height: 200 } },
          { id: 't-foot', type: 'text', preset: 'footnote', html: 'Foot', position: { x: 60, y: 980, width: 1800, height: 60 } },
          { id: 'img', type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', borderRadius: 12, opacity: 0.9, rotation: 5, position: { x: 1000, y: 180, width: 400, height: 300 } },
          { id: 'arr', type: 'arrow', x1: 100, y1: 600, x2: 500, y2: 650, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } },
          { id: 'cov', type: 'cover', color: '#222', position: { x: 1400, y: 600, width: 300, height: 200 } },
          { id: 'vid', type: 'video', kind: 'embed', src: 'https://www.youtube.com/watch?v=abc123', position: { x: 60, y: 400, width: 640, height: 360 } },
          { id: 'demo', type: 'demo', demoSrc: 'demos/x.html', position: { x: 800, y: 600, width: 400, height: 300 } },
        ],
      }],
    };
  }
  it('matches the committed snapshot', async () => {
    const html = await buildExportHtml({
      presentation: everyTypeDeck(),
      readFile: async () => new Uint8Array([1, 2, 3]),
      // A real (marked) eigendeck demo — the export marker gate renders it; an unmarked
      // .html would export the "not a valid demo" placeholder instead (see exportCore).
      readTextFile: async () => '<!DOCTYPE html><!--eigendeck-demo-v1--><html><body>demo-fixed</body></html>',
      renderMath: (h) => h,
      applyMathPreamble: null,
      getElementPreview: async () => 'data:image/png;base64,UFJFVklFVw==',
      resolveFont: () => 'PT Sans',
      resolveMathBundle: () => 'ptsans',
    });
    expect(html).toMatchSnapshot();
  });
});
