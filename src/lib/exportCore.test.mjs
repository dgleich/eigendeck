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
    // Should include MathJax CDN fallback since math wasn't pre-rendered
    expect(html).toContain('mathjax@3');
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
