// Headless RENDER check for the two static export paths — rasterizes the HTML
// export and the print/PDF HTML in a real browser to confirm the PIXELS paint
// (gradients, dark backgrounds, Card tints, arrow heads/curves, html scaleMode
// contain-fit, print-color-adjust, and the print px→inch down-scaling). String
// assertions (exportMatrix.test.mjs) can't catch a "looks wrong" regression; this
// can. PNGs land in gitignore/export-audit/ for eyeballing / baselining.
//
// HEAVY + browser-dependent, so it's OPT-IN — it only runs when EIGENDECK_RENDER=1
// AND Playwright is resolvable; otherwise the whole block is skipped, so the
// default `vitest` run (and machines without a browser) are unaffected.
//
//   EIGENDECK_RENDER=1 npx vitest run src/lib/exportRender.test.mjs
//   # optional: EIGENDECK_PW=<path to playwright-core> EIGENDECK_CHROME=<chrome exe>
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildExportHtml } from './exportCore.mjs';
import { buildPrintSlideHtml } from './printSlideHtml';

const RUN = process.env.EIGENDECK_RENDER === '1';
const OUT = 'gitignore/export-audit/';

function deck(elements, { theme = 'white', config = {} } = {}) {
  const slide = { id: 's1', layout: 'default', notes: '', elements };
  return { presentation: { title: 'Audit', theme, config: { width: 1920, height: 1080, ...config }, slides: [slide] }, slide };
}
async function exportHtml(elements, opts = {}) {
  const { presentation } = deck(elements, opts);
  return buildExportHtml({
    presentation,
    readFile: async () => new Uint8Array([]),
    readTextFile: async () => '<!--eigendeck-demo-v1--><html><head></head><body>demo</body></html>',
    getElementPreview: async () => null,
    ...opts.wiring,
  });
}
function printHtml(elements, opts = {}) {
  const { slide, presentation } = deck(elements, opts);
  return buildPrintSlideHtml(slide, presentation, new Map(opts.imageCache || []), new Map(), undefined, 1);
}

// Representative content that exercised the real print bugs: a full-bleed gradient,
// a scaleMode (natural-size) card, a themed Card, straight + curved arrows, and a
// fixed-px-layout card (must shrink WITH its box in print, not overflow ~1.8x).
const gradientCard = { id: 'h', type: 'html', html: '<div style="width:100%;height:100%;background:linear-gradient(135deg,#ff0080,#7928ca);color:#fff;font:48px sans-serif;display:flex;align-items:center;justify-content:center;">GRADIENT</div>', background: '#000', position: { x: 100, y: 100, width: 700, height: 300 } };
const scaled = { id: 'h2', type: 'html', html: '<div style="width:200px;height:100px;background:#00aaff;color:#fff;font:32px sans-serif;display:flex;align-items:center;justify-content:center;">SCALE</div>', scaleMode: true, scaleW: 200, scaleH: 100, position: { x: 100, y: 450, width: 700, height: 250 } };
const cardTint = { id: 't', type: 'text', preset: 'body', html: 'Card tint text', boxTint: 'accent', boxShadow: true, borderRadius: 16, position: { x: 900, y: 100, width: 400, height: 180 } };
const arrows = [
  { id: 'a1', type: 'arrow', x1: 900, y1: 400, x2: 1400, y2: 480, heads: 'both', color: '#e53e3e', strokeWidth: 6, headSize: 28, position: { x: 0, y: 0, width: 0, height: 0 } },
  { id: 'a2', type: 'arrow', x1: 900, y1: 560, x2: 1400, y2: 640, c1x: 1000, c1y: 760, c2x: 1300, c2y: 760, color: '#2563eb', strokeWidth: 5, opacity: 0.6, position: { x: 0, y: 0, width: 0, height: 0 } },
];
const textCard = { id: 'tc', type: 'html', background: '#fdf2f8', html:
  '<div style="width:100%;height:100%;box-sizing:border-box;padding:24px;font-family:sans-serif;color:#831843;">'
  + '<h2 style="margin:0 0 12px;font-size:40px;">Fixed layout</h2>'
  + '<p style="margin:0;font-size:22px;line-height:1.4;">This text is authored in CSS px. In print it must scale down with its box, not overflow it.</p></div>',
  position: { x: 900, y: 760, width: 620, height: 260 } };
const els = [gradientCard, scaled, cardTint, textCard, ...arrows];

async function shot(page, html, file, isSlideDoc) {
  const doc = isSlideDoc ? html
    : `<!doctype html><html><head><style>body{margin:0}.slide{width:1056px;height:594px;position:relative;}</style></head><body>${html}</body></html>`;
  await page.setContent(doc, { waitUntil: 'networkidle' });
  if (isSlideDoc) await page.evaluate(() => { const s = document.querySelector('.slide'); if (s) { s.classList.add('active'); s.style.transform = 'none'; s.style.position = 'static'; s.style.margin = '0'; } });
  await page.waitForTimeout(400);
  const png = await page.screenshot();
  writeFileSync(OUT + file, png);
  return png;
}

// A minimal-but-real assertion beyond "it ran": a valid, non-trivial PNG (magic
// bytes + size). Pixel-diff / baseline comparison is the natural next step.
function assertPng(png) {
  expect(png.length).toBeGreaterThan(2000);
  expect(png[0]).toBe(0x89); expect(png[1]).toBe(0x50);   // PNG signature ‰P
}

describe.runIf(RUN)('headless render (visual)', () => {
  it('rasterizes export + print in white/dark themes to PNG', async () => {
    let chromium;
    try {
      ({ chromium } = await import(process.env.EIGENDECK_PW || 'playwright-core'));
    } catch {
      console.warn('[exportRender] playwright-core not resolvable — skipping render check');
      return;
    }
    mkdirSync(OUT, { recursive: true });
    const launchOpts = { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
    if (process.env.EIGENDECK_CHROME) launchOpts.executablePath = process.env.EIGENDECK_CHROME;
    const browser = await chromium.launch(launchOpts);
    try {
      const ep = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      assertPng(await shot(ep, await exportHtml(els, { theme: 'white' }), 'export-white.png', true));
      assertPng(await shot(ep, await exportHtml(els, { theme: 'dark' }), 'export-dark.png', true));
      const pp = await browser.newPage({ viewport: { width: 1056, height: 594 } });
      assertPng(await shot(pp, printHtml(els, { theme: 'white' }), 'print-white.png', false));
      assertPng(await shot(pp, printHtml(els, { theme: 'dark' }), 'print-dark.png', false));
    } finally {
      await browser.close();
    }
  }, 120000);
});
