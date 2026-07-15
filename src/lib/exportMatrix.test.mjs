// Comprehensive WYSIWYG matrix audit for Eigendeck's TWO static export paths:
//   Path #4  HTML export  — buildExportHtml() in src/lib/exportCore.mjs
//   Path #5  print / PDF  — buildPrintSlideHtml() in src/lib/printSlideHtml.ts
//
// For each (element type × style) cell we build a minimal Slide/Presentation,
// render it through BOTH pure builders, and assert the styling actually appears
// in the output string. A dropped property = a failing assertion here.
//
// HTML export is exercised in BOTH caller wirings:
//   • "app" wiring  — renderTextElement provided (SVG text path, fileOps.ts)
//   • "cli" wiring  — renderTextElement omitted (legacy textElementHtml path)
// because text-box styling is split differently between them.
//
// Run:  npx vitest run src/lib/exportMatrix.test.mjs
import { describe, it, expect } from 'vitest';
import { buildExportHtml } from './exportCore.mjs';
import { buildPrintSlideHtml } from './printSlideHtml';

// ---- helpers ---------------------------------------------------------------

function deck(elements, { theme = 'white', config = {}, slideExtra = {} } = {}) {
  const slide = { id: 's1', theme: undefined, layout: 'default', notes: '', elements, ...slideExtra };
  return {
    presentation: {
      title: 'Audit', theme, config: { width: 1920, height: 1080, ...config }, slides: [slide],
    },
    slide,
  };
}

// HTML export with a given wiring. `renderTextElement` mimics the app's SVG path
// (just wraps content in a marker so we can detect it); omit for the CLI path.
async function exportHtml(elements, opts = {}) {
  const { presentation } = deck(elements, opts);
  const base = {
    presentation,
    readFile: async () => new Uint8Array([1, 2, 3, 4]),
    readTextFile: async () => '<!--eigendeck-demo-v1--><html><head></head><body>demo</body></html>',
    getElementPreview: async (el) => (opts.previews === false ? null : `data:image/png;base64,PREVIEW_${el.type}`),
    ...opts.wiring,
  };
  return buildExportHtml(base);
}

function printHtml(elements, opts = {}) {
  const { slide, presentation } = deck(elements, opts);
  const imageCache = new Map(opts.imageCache || []);
  const demoScreenshots = new Map(opts.demoScreenshots || []);
  return buildPrintSlideHtml(slide, presentation, imageCache, demoScreenshots, opts.mathHtmlByKey, opts.slideNumber);
}

const T = (over = {}) => ({ id: 't', type: 'text', preset: 'body', html: 'Hello', position: { x: 10, y: 20, width: 300, height: 100 }, ...over });
const IMG = (over = {}) => ({ id: 'i', type: 'image', assetId: 'A', src: 'a.png', position: { x: 10, y: 20, width: 300, height: 200 }, ...over });
const ARR = (over = {}) => ({ id: 'a', type: 'arrow', x1: 100, y1: 100, x2: 400, y2: 200, position: { x: 0, y: 0, width: 0, height: 0 }, ...over });
const COV = (over = {}) => ({ id: 'c', type: 'cover', position: { x: 10, y: 20, width: 300, height: 200 }, ...over });
const HTM = (over = {}) => ({ id: 'h', type: 'html', html: '<h1>Hi</h1>', position: { x: 10, y: 20, width: 400, height: 200 }, ...over });

// ---------------------------------------------------------------------------
// TEXT
// ---------------------------------------------------------------------------
describe('text — HTML export (CLI legacy path)', () => {
  it('background color + opacity → rgba', async () => {
    const h = await exportHtml([T({ backgroundColor: '#ff0000', backgroundOpacity: 0.5 })]);
    expect(h).toMatch(/background:rgba\(255, 0, 0, 0\.5\)/);
  });
  it('boxTint (Card #132) resolves against theme', async () => {
    const h = await exportHtml([T({ boxTint: '#ff0000' })]);
    expect(h).toMatch(/background:#/); // a mixed hex fill, not the raw color
  });
  it('box shadow (with bg)', async () => {
    const h = await exportHtml([T({ backgroundColor: '#eee', boxShadow: true })]);
    expect(h).toContain('box-shadow:0 4px 14px');
  });
  it('text effect (glow) → text-shadow', async () => {
    const h = await exportHtml([T({ textEffect: 'glow' })]);
    expect(h).toContain('text-shadow:');
  });
  it('custom padding', async () => {
    const h = await exportHtml([T({ padding: { top: 5, right: 7, bottom: 9, left: 11 } })]);
    expect(h).toContain('padding:5px 7px 9px 11px');
  });
  it('vertical align middle', async () => {
    const h = await exportHtml([T({ verticalAlign: 'middle' })]);
    expect(h).toContain('justify-content:center');
  });
  it('border radius', async () => {
    const h = await exportHtml([T({ borderRadius: 16, backgroundColor: '#eee' })]);
    expect(h).toContain('border-radius:16px');
  });
  it('rotation', async () => {
    const h = await exportHtml([T({ rotation: 12 })]);
    expect(h).toContain('rotate(12deg)');
  });
  it('explicit fontSize', async () => {
    const h = await exportHtml([T({ fontSize: 77 })]);
    expect(h).toContain('font-size:77px');
  });
  it('named fontSizeName', async () => {
    const h = await exportHtml([T({ fontSizeName: 'footnote' })]);
    // footnote named size resolves to some px value
    expect(h).toMatch(/font-size:\d+px/);
  });
  it('accent color token resolves to theme accent', async () => {
    const h = await exportHtml([T({ color: 'accent' })], { theme: 'white' });
    // accent for white theme is a specific color, not the literal 'accent'
    expect(h).not.toContain('color:accent');
  });
  it('inline rich text (bold) preserved', async () => {
    const h = await exportHtml([T({ html: 'a <b>bold</b> word' })]);
    expect(h).toContain('<b>bold</b>');
  });
  it('code font applied to <code>', async () => {
    const h = await exportHtml([T({ html: 'run <code>x</code>' })], { config: { defaultMonoFont: 'firacode' } });
    expect(h).toMatch(/<code style="font-family:/);
  });
});

describe('text — HTML export (app SVG path)', () => {
  const wiring = { renderTextElement: async (el) => `<svg data-svg="1">${el.html}</svg>` };
  it('bg on wrapper', async () => {
    const h = await exportHtml([T({ backgroundColor: '#ff0000' })], { wiring });
    expect(h).toContain('background:#ff0000');
    expect(h).toContain('data-svg="1"');
  });
  it('box shadow on wrapper', async () => {
    const h = await exportHtml([T({ backgroundColor: '#eee', boxShadow: true })], { wiring });
    expect(h).toContain('box-shadow:');
  });
  it('border radius on wrapper', async () => {
    const h = await exportHtml([T({ borderRadius: 20 })], { wiring });
    expect(h).toContain('border-radius:20px');
  });
  it('rotation on wrapper', async () => {
    const h = await exportHtml([T({ rotation: 8 })], { wiring });
    expect(h).toContain('rotate(8deg)');
  });
  // padding / valign / text-effect live INSIDE the SVG (produced by
  // renderTextElement / buildTextElementSvgMarkup), so they are the renderer's
  // concern, not exportCore's — asserted separately in TextElementSvg tests.
});

describe('text — print/PDF', () => {
  it('background color + opacity → rgba', () => {
    const h = printHtml([T({ backgroundColor: '#ff0000', backgroundOpacity: 0.5 })]);
    expect(h).toMatch(/background:rgba\(255, 0, 0, 0\.5\)/);
  });
  it('boxTint resolves against theme', () => {
    const h = printHtml([T({ boxTint: '#ff0000' })]);
    expect(h).toMatch(/background:#/);
  });
  it('box shadow', () => {
    const h = printHtml([T({ backgroundColor: '#eee', boxShadow: true })]);
    expect(h).toContain('box-shadow:0 4px 14px');
  });
  it('text effect → text-shadow', () => {
    const h = printHtml([T({ textEffect: 'glow' })]);
    expect(h).toContain('text-shadow:');
  });
  it('custom padding (in inches)', () => {
    const h = printHtml([T({ padding: { top: 20, right: 20, bottom: 20, left: 20 } })]);
    // padding formatted with px2in
    expect(h).toMatch(/padding:[\d.]+in/);
  });
  it('vertical align middle', () => {
    const h = printHtml([T({ verticalAlign: 'middle' })]);
    expect(h).toContain('justify-content:center');
  });
  it('border radius (inches)', () => {
    const h = printHtml([T({ borderRadius: 16, backgroundColor: '#eee' })]);
    expect(h).toMatch(/border-radius:[\d.]+in/);
  });
  it('rotation', () => {
    const h = printHtml([T({ rotation: 12 })]);
    expect(h).toContain('rotate(12deg)');
  });
  it('explicit fontSize (points)', () => {
    const h = printHtml([T({ fontSize: 96 })]);
    expect(h).toMatch(/font-size:[\d.]+pt/);
  });
  it('accent color token', () => {
    const h = printHtml([T({ color: 'accent' })]);
    expect(h).not.toContain('color:accent');
  });
  it('inline rich text preserved', () => {
    const h = printHtml([T({ html: 'a <b>bold</b> word' })]);
    expect(h).toContain('<b>bold</b>');
  });
  it('pre-rendered math used when provided', () => {
    const h = printHtml([T({ id: 'm', html: '$x$' })], { mathHtmlByKey: new Map([['s1:m', '<svg data-math></svg>']]) });
    expect(h).toContain('<svg data-math>');
  });
});

// ---------------------------------------------------------------------------
// IMAGE
// ---------------------------------------------------------------------------
describe('image — HTML export', () => {
  it('shadow filter', async () => {
    const h = await exportHtml([IMG({ shadow: true })]);
    expect(h).toContain('filter:drop-shadow(');
  });
  it('border radius', async () => {
    const h = await exportHtml([IMG({ borderRadius: 12 })]);
    expect(h).toContain('border-radius:12px');
  });
  it('opacity < 1', async () => {
    const h = await exportHtml([IMG({ opacity: 0.4 })]);
    expect(h).toContain('opacity:0.4');
  });
  it('rotation', async () => {
    const h = await exportHtml([IMG({ rotation: 15 })]);
    expect(h).toContain('rotate(15deg)');
  });
  it('object-fit contain', async () => {
    const h = await exportHtml([IMG()]);
    expect(h).toContain('object-fit:contain');
  });
  it('pdf kind uses preview PNG', async () => {
    const h = await exportHtml([IMG({ kind: 'pdf' })]);
    expect(h).toContain('PREVIEW_image');
  });
});

describe('image — print/PDF', () => {
  const imageCache = [['A', 'data:image/png;base64,IMG']];
  it('shadow filter', () => {
    const h = printHtml([IMG({ shadow: true })], { imageCache });
    expect(h).toContain('filter:drop-shadow(');
  });
  it('border radius (px in inv-visuals — raw px)', () => {
    const h = printHtml([IMG({ borderRadius: 12 })], { imageCache });
    expect(h).toContain('border-radius:12px');
  });
  it('opacity < 1', () => {
    const h = printHtml([IMG({ opacity: 0.4 })], { imageCache });
    expect(h).toContain('opacity:0.4');
  });
  it('rotation', () => {
    const h = printHtml([IMG({ rotation: 15 })], { imageCache });
    expect(h).toContain('rotate(15deg)');
  });
  it('object-fit contain', () => {
    const h = printHtml([IMG()], { imageCache });
    expect(h).toContain('object-fit:contain');
  });
});

// ---------------------------------------------------------------------------
// ARROW  (the #98 known-gap cluster)
// ---------------------------------------------------------------------------
describe('arrow — HTML export', () => {
  it('end head → one polygon', async () => {
    const h = await exportHtml([ARR({ heads: 'end', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(1);
  });
  it('both heads → two polygons', async () => {
    const h = await exportHtml([ARR({ heads: 'both', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(2);
  });
  it('no heads → zero polygons', async () => {
    const h = await exportHtml([ARR({ heads: 'none', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(0);
  });
  it('opacity', async () => {
    const h = await exportHtml([ARR({ opacity: 0.5, color: '#111' })]);
    expect(h).toContain('opacity="0.5"');
  });
  it('strokeWidth', async () => {
    const h = await exportHtml([ARR({ strokeWidth: 9, color: '#111' })]);
    expect(h).toContain('stroke-width="9"');
  });
  it('color', async () => {
    const h = await exportHtml([ARR({ color: '#abcdef' })]);
    expect(h).toContain('#abcdef');
  });
  it('curved → path', async () => {
    const h = await exportHtml([ARR({ color: '#111', c1x: 150, c1y: 300, c2x: 350, c2y: 300 })]);
    expect(h).toContain('<path d="M ');
  });
  it('headSize affects triangle geometry', async () => {
    const small = await exportHtml([ARR({ headSize: 8, color: '#111' })]);
    const big = await exportHtml([ARR({ headSize: 40, color: '#111' })]);
    expect(small).not.toBe(big);
  });
});

describe('arrow — print/PDF', () => {
  it('end head → one polygon', () => {
    const h = printHtml([ARR({ heads: 'end', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(1);
  });
  it('both heads → two polygons', () => {
    const h = printHtml([ARR({ heads: 'both', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(2);
  });
  it('no heads → zero polygons', () => {
    const h = printHtml([ARR({ heads: 'none', color: '#111' })]);
    expect((h.match(/<polygon /g) || []).length).toBe(0);
  });
  it('opacity', () => {
    const h = printHtml([ARR({ opacity: 0.5, color: '#111' })]);
    expect(h).toContain('opacity="0.5"');
  });
  it('strokeWidth', () => {
    const h = printHtml([ARR({ strokeWidth: 9, color: '#111' })]);
    expect(h).toContain('stroke-width="9"');
  });
  it('color', () => {
    const h = printHtml([ARR({ color: '#abcdef' })]);
    expect(h).toContain('#abcdef');
  });
  it('curved → path', () => {
    const h = printHtml([ARR({ color: '#111', c1x: 150, c1y: 300, c2x: 350, c2y: 300 })]);
    expect(h).toContain('<path d="M ');
  });
  it('viewBox present (px→inch mapping)', () => {
    const h = printHtml([ARR({ color: '#111' })]);
    expect(h).toContain('viewBox="0 0 1920 1080"');
  });
});

// ---------------------------------------------------------------------------
// COVER
// ---------------------------------------------------------------------------
describe('cover — HTML export', () => {
  it('explicit color', async () => {
    const h = await exportHtml([COV({ color: '#222' })]);
    expect(h).toContain('background:#222');
  });
  it('boxTint (themed wash)', async () => {
    const h = await exportHtml([COV({ boxTint: 'accent' })], { theme: 'dark' });
    expect(h).toMatch(/background:#/);
  });
  it('no color → slide theme background', async () => {
    const h = await exportHtml([COV()], { theme: 'white' });
    expect(h).toMatch(/background:#(fff|ffffff)/i);
  });
});

describe('cover — print/PDF', () => {
  it('explicit color', () => {
    const h = printHtml([COV({ color: '#222' })]);
    expect(h).toContain('background:#222');
  });
  it('boxTint (themed wash)', () => {
    const h = printHtml([COV({ boxTint: 'accent' })], { theme: 'dark' });
    expect(h).toMatch(/background:#/);
  });
});

// ---------------------------------------------------------------------------
// HTML element (#137) — background, scaleMode, sandbox
// ---------------------------------------------------------------------------
describe('html element — HTML export', () => {
  it('locked sandbox (no scripts)', async () => {
    const h = await exportHtml([HTM()]);
    expect(h).toContain('sandbox=""');
    expect(h).not.toContain('allow-scripts');
  });
  it('background carried into srcdoc', async () => {
    const h = await exportHtml([HTM({ background: '#123456' })]);
    expect(h).toContain('background:#123456');
  });
  it('content escaped into srcdoc', async () => {
    const h = await exportHtml([HTM({ html: '<h1>Hi</h1>' })]);
    expect(h).toContain('&lt;h1&gt;Hi&lt;/h1&gt;');
  });
  it('print-color-adjust in srcdoc', async () => {
    const h = await exportHtml([HTM({ background: '#123456' })]);
    expect(h).toContain('print-color-adjust:exact');
  });
  it('scaleMode → wrapper overflow:hidden + scale transform (px)', async () => {
    const h = await exportHtml([HTM({ scaleMode: true, scaleW: 200, scaleH: 100, position: { x: 0, y: 0, width: 400, height: 100 } })]);
    expect(h).toContain('overflow:hidden');
    expect(h).toMatch(/transform:translate\([\d.]+px,[\d.]+px\) scale\(/);
    expect(h).toContain('transform-origin:top left');
  });
});

describe('html element — print/PDF', () => {
  it('locked sandbox (no scripts)', () => {
    const h = printHtml([HTM()]);
    expect(h).toContain('sandbox=""');
    expect(h).not.toContain('allow-scripts');
  });
  it('background carried into srcdoc', () => {
    const h = printHtml([HTM({ background: '#123456' })]);
    expect(h).toContain('background:#123456');
  });
  it('print-color-adjust in srcdoc', () => {
    const h = printHtml([HTM({ background: '#123456' })]);
    expect(h).toContain('print-color-adjust:exact');
  });
  it('scaleMode → wrapper overflow:hidden + scale transform (F2 fixed: CSS-px inner frame)', () => {
    const h = printHtml([HTM({ scaleMode: true, scaleW: 200, scaleH: 100, position: { x: 0, y: 0, width: 400, height: 100 } })]);
    expect(h).toContain('overflow:hidden');
    // FIXED: the iframe is sized in CSS px (design size) and scaled DOWN for the
    // inch box, not sized in inches (which shrank its px canvas ~2× and clipped).
    expect(h).toMatch(/transform:translate\([\d.]+px,[\d.]+px\) scale\(/);
    expect(h).toContain('transform-origin:top left');
  });
  it('scaleMode inner frame is CSS-px (design size), wrapper is inches', () => {
    const h = printHtml([HTM({ scaleMode: true, scaleW: 200, scaleH: 100, position: { x: 0, y: 0, width: 400, height: 100 } })]);
    expect(h).toContain('width:200px;height:100px');   // design frame in CSS px
    expect(h).toMatch(/width:[\d.]+in;height:[\d.]+in;overflow:hidden/);   // wrapper in inches
  });
});

// ---------------------------------------------------------------------------
// LIVE types — demo / demo-piece / video / notebook
// ---------------------------------------------------------------------------
describe('live types — HTML export', () => {
  it('demo → live iframe (valid demo)', async () => {
    const h = await exportHtml([{ id: 'd', type: 'demo', src: 'd.html', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).toContain('<iframe srcdoc=');
  });
  it('notebook (app wiring: renderNotebookElement) → inline html', async () => {
    const h = await exportHtml([{ id: 'n', type: 'notebook', assetId: 'N', src: 'n.ipynb', position: { x: 0, y: 0, width: 300, height: 200 } }],
      { wiring: { renderNotebookElement: async () => '<iframe data-nb></iframe>' } });
    expect(h).toContain('data-nb');
  });
  it('notebook (CLI wiring: no renderNotebookElement) → preview PNG', async () => {
    const h = await exportHtml([{ id: 'n', type: 'notebook', assetId: 'N', src: 'n.ipynb', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).toContain('PREVIEW_notebook');
  });
  it('notebook (cold: no preview) → placeholder', async () => {
    const h = await exportHtml([{ id: 'n', type: 'notebook', assetId: 'N', src: 'n.ipynb', position: { x: 0, y: 0, width: 300, height: 200 } }], { previews: false });
    expect(h.toLowerCase()).toContain('nb');
  });
  it('video embed → provider iframe (YouTube: direct nocookie URL, NOT the shim)', async () => {
    const h = await exportHtml([{ id: 'v', type: 'video', kind: 'embed', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    // Export is a standalone file opened at a REAL origin (a web host), so it uses
    // the direct provider URL — the loopback shim is a live-packaged-app-only fix.
    expect(h).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(h).not.toContain('127.0.0.1');   // never the loopback shim in an export
    expect(h).not.toContain('enablejsapi');  // export passes jsApi:false
  });
  it('video embed → Vimeo iframe', async () => {
    const h = await exportHtml([{ id: 'v', type: 'video', kind: 'embed', url: 'https://vimeo.com/123456', provider: 'vimeo', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).toContain('<iframe src="https://player.vimeo.com/video/123456');
  });
  it('video embed with an unrecognized/invalid id → clickable link fallback (never dropped)', async () => {
    const h = await exportHtml([{ id: 'v', type: 'video', kind: 'embed', url: 'https://youtube.com/watch?v=bad', provider: 'youtube', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).not.toContain('<iframe');
    expect(h).toContain('href="https://youtube.com/watch?v=bad"'); // degrades to a "▶ Video" link
  });
  it('video file → inline <video> with controls/loop/autoplay', async () => {
    const h = await exportHtml([{ id: 'v', type: 'video', kind: 'file', src: 'v.mp4', controls: true, loop: true, autoplay: true, position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).toContain('<video');
    expect(h).toContain('controls');
    expect(h).toContain('loop');
    expect(h).toContain('autoplay');
    expect(h).toContain('muted');
  });
});

describe('slide footer (#135)', () => {
  it('default: footer present, Lato in the export CSS', async () => {
    const h = await exportHtml([]);
    expect(h).toContain('class="slide-footer"');
    expect(h).toMatch(/\.slide-footer\s*\{[^}]*font-family:\s*'Lato'/);
  });
  it('config.footerFont sets the .slide-footer font-family', async () => {
    const h = await exportHtml([], { config: { footerFont: 'shantell' } });
    expect(h).toMatch(/\.slide-footer\s*\{[^}]*font-family:\s*'Shantell Sans'/);
  });
  it('slide.omitFooter drops the footer markup for that slide (CSS selector stays)', async () => {
    const h = await exportHtml([], { slideExtra: { omitFooter: true } });
    expect(h).not.toContain('class="slide-footer"');
  });
  // Path #5 (print/PDF) must honor both features too — the #98/#85 drift class.
  it('print: default footer Lato + shows the number', () => {
    const h = printHtml([], { slideNumber: 3 });
    expect(h).toContain('class="slide-footer"');
    expect(h).toContain("font-family:'Lato'");
  });
  it('print: config.footerFont applies', () => {
    const h = printHtml([], { slideNumber: 3, config: { footerFont: 'shantell' } });
    expect(h).toContain("font-family:'Shantell Sans'");
  });
  it('print: slide.omitFooter hides the footer', () => {
    const h = printHtml([], { slideNumber: 3, slideExtra: { omitFooter: true } });
    expect(h).not.toContain('class="slide-footer"');
  });
});

describe('live types — print/PDF (baked screenshot)', () => {
  it('demo baked screenshot used', () => {
    const h = printHtml([{ id: 'd', type: 'demo', src: 'd.html', position: { x: 0, y: 0, width: 300, height: 200 } }],
      { demoScreenshots: [['s1:d', 'data:image/png;base64,SHOT']] });
    expect(h).toContain('SHOT');
  });
  it('notebook baked screenshot used', () => {
    const h = printHtml([{ id: 'n', type: 'notebook', assetId: 'N', position: { x: 0, y: 0, width: 300, height: 200 } }],
      { demoScreenshots: [['s1:n', 'data:image/png;base64,NBSHOT']] });
    expect(h).toContain('NBSHOT');
  });
  it('live type without screenshot → labelled placeholder', () => {
    const h = printHtml([{ id: 'v', type: 'video', kind: 'file', position: { x: 0, y: 0, width: 300, height: 200 } }]);
    expect(h).toContain('Video');
  });
});
