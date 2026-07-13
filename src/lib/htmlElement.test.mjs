import { describe, it, expect } from 'vitest';
import {
  htmlElementSrcdoc, htmlElementIframeHtml, htmlElementScaledIframeHtml,
  htmlIsScaled, htmlScaleLayout,
  HTML_SANDBOX_LOCKED, HTML_SANDBOX_EDITABLE, HTML_ELEMENT_CSP,
} from './htmlElement.mjs';

describe('htmlElementSrcdoc (#137)', () => {
  it('wraps raw HTML in a doc carrying the no-network CSP', () => {
    const doc = htmlElementSrcdoc('<h1>Hi</h1>');
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain(`content="${HTML_ELEMENT_CSP}"`);
    // The CSP blocks all network and allows only data: URIs + inline styles.
    expect(HTML_ELEMENT_CSP).toContain("default-src 'none'");
    expect(HTML_ELEMENT_CSP).toContain('img-src data:');
    expect(HTML_ELEMENT_CSP).not.toContain('http');
  });

  it('sets print-color-adjust:exact so backgrounds survive print/PDF (#137)', () => {
    // Without this the sandboxed iframe drops its backgrounds/gradients when the
    // deck is printed (the parent print-color-adjust does not cascade into it).
    expect(htmlElementSrcdoc('<div>x</div>')).toContain('print-color-adjust:exact');
  });

  it('defaults to a transparent background, honours an override', () => {
    expect(htmlElementSrcdoc('x')).toContain('background:transparent;');
    expect(htmlElementSrcdoc('x', '#ffeecc')).toContain('background:#ffeecc;');
  });

  it('strips angle brackets/quotes from the background (no style breakout)', () => {
    expect(htmlElementSrcdoc('x', '"><script>')).not.toContain('<script>');
  });

  it('tolerates a missing/undefined body', () => {
    expect(htmlElementSrcdoc(undefined)).toContain('<body></body>');
  });

  it('splices variables by default but keeps the raw template in raw mode (#138)', () => {
    const html = '<script type="application/eigendeck-vars+json">'
      + '{"v":{"type":"int","default":7}}</script><b>{{v}}</b>';
    // Default: manifest stripped, token spliced, :root var emitted.
    const spliced = htmlElementSrcdoc(html, undefined, { v: 9 });
    expect(spliced).toContain('<b>9</b>');
    expect(spliced).toContain('--v:9;');
    expect(spliced).not.toContain('eigendeck-vars+json');
    expect(spliced).not.toContain('{{v}}');
    // Raw (edit) mode: manifest + literal token preserved so read-back keeps them.
    const raw = htmlElementSrcdoc(html, undefined, { v: 9 }, undefined, { raw: true });
    expect(raw).toContain('eigendeck-vars+json');
    expect(raw).toContain('{{v}}');
    expect(raw).not.toContain('--v:');
  });
});

describe('html tables (#137)', () => {
  // A realistic LLM-authored table: nested thead/tbody, quoted style + colspan
  // attributes, unicode — good stress for the srcdoc + attribute escaping.
  const TABLE = '<table style="width:100%;border-collapse:collapse">'
    + '<thead><tr><th>Method</th><th colspan="2">Result</th></tr></thead>'
    + '<tbody><tr><td>Lanczos</td><td>λ₁…λₖ</td><td>fast</td></tr></tbody></table>';

  it('carries the full table structure verbatim into the srcdoc body', () => {
    const doc = htmlElementSrcdoc(TABLE);
    expect(doc).toContain('<table style="width:100%;border-collapse:collapse">');
    expect(doc).toContain('<th colspan="2">Result</th>');
    expect(doc).toContain('<td>λ₁…λₖ</td>');   // unicode preserved
    expect(doc).toContain('</tbody></table>');
  });

  it('attribute-escapes the whole table for the srcdoc="" attribute (no host breakout)', () => {
    const html = htmlElementIframeHtml({ html: TABLE }, 'position:absolute;');
    // Every tag/quote is escaped so nothing lands as real markup in the host doc.
    expect(html).toContain('&lt;table');
    expect(html).toContain('colspan=&quot;2&quot;');
    expect(html).not.toContain('<table');        // no raw <table> leaked out
    expect(html).not.toContain('<td>');
  });
});

describe('htmlElementIframeHtml (#137)', () => {
  it('emits a sandboxed iframe with the srcdoc attribute-escaped', () => {
    const html = htmlElementIframeHtml({ html: '<b title="a&b">x</b>' }, 'position:absolute;');
    expect(html).toMatch(/^<iframe srcdoc="/);
    expect(html).toContain(`sandbox="${HTML_SANDBOX_LOCKED}"`);   // locked by default
    // The inner HTML's quotes/ampersands are escaped so they can't break the attr.
    expect(html).toContain('&quot;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('title="a&b"');
  });

  it('never carries allow-scripts; editable sandbox is same-origin only', () => {
    expect(HTML_SANDBOX_LOCKED).not.toContain('allow-scripts');
    expect(HTML_SANDBOX_EDITABLE).not.toContain('allow-scripts');
    expect(HTML_SANDBOX_EDITABLE).toBe('allow-same-origin');
    const editable = htmlElementIframeHtml({ html: 'x' }, '', HTML_SANDBOX_EDITABLE);
    expect(editable).toContain('sandbox="allow-same-origin"');
  });
});

describe('html scale mode (#137)', () => {
  it('htmlIsScaled needs the flag AND a design size', () => {
    expect(htmlIsScaled({ scaleMode: true, scaleW: 200, scaleH: 100 })).toBe(true);
    expect(htmlIsScaled({ scaleMode: true })).toBe(false);          // no design size
    expect(htmlIsScaled({ scaleW: 200, scaleH: 100 })).toBe(false); // flag off
    expect(htmlIsScaled(null)).toBe(false);
  });

  it('contain layout: box wider than design → fit by height, centred horizontally', () => {
    // design 200×100 (2:1), box 800×200 (4:1). Height binds: scale = 200/100 = 2.
    const L = htmlScaleLayout(800, 200, 200, 100);
    expect(L.scale).toBe(2);
    expect(L.designW).toBe(200); expect(L.designH).toBe(100);
    expect(L.offsetY).toBe(0);                    // fills the height
    expect(L.offsetX).toBe((800 - 200 * 2) / 2);  // = 200, letterboxed sides
  });

  it('contain layout: box taller than design → fit by width, centred vertically', () => {
    // design 200×100 (2:1), box 200×400. Width binds: scale = 200/200 = 1.
    const L = htmlScaleLayout(200, 400, 200, 100);
    expect(L.scale).toBe(1);
    expect(L.offsetX).toBe(0);
    expect(L.offsetY).toBe((400 - 100) / 2);      // = 150
  });

  it('same aspect → exact fill, no letterbox', () => {
    const L = htmlScaleLayout(400, 200, 200, 100);
    expect(L.scale).toBe(2);
    expect(L.offsetX).toBe(0); expect(L.offsetY).toBe(0);
  });

  it('degenerate design size falls back to scale 1 (no-op)', () => {
    const L = htmlScaleLayout(300, 200, 0, 0);
    expect(L.scale).toBe(1);
    expect(L.designW).toBe(300); expect(L.designH).toBe(200);
  });

  it('scaled string render wraps a clipped box around a transformed frame', () => {
    const el = { html: '<div>x</div>', scaleMode: true, scaleW: 200, scaleH: 100 };
    const L = htmlScaleLayout(800, 200, 200, 100);
    const out = htmlElementScaledIframeHtml(el, 'position:absolute;left:10px;top:20px;width:800px;height:200px', L, 'px');
    expect(out).toMatch(/^<div style="position:absolute;left:10px;top:20px;width:800px;height:200px;overflow:hidden;">/);
    expect(out).toContain('width:200px;height:100px;');          // design size on the frame
    expect(out).toContain('transform:translate(200px,0px) scale(2);');
    expect(out).toContain('transform-origin:top left;');
    expect(out).toContain(`sandbox="${HTML_SANDBOX_LOCKED}"`);   // still locked
    expect(out).toContain('&lt;div&gt;x&lt;/div&gt;');           // body srcdoc-escaped
  });

  it('scaled string render carries inches for the print path (scale stays unitless)', () => {
    const el = { html: 'x', scaleMode: true, scaleW: 200, scaleH: 100 };
    const out = htmlElementScaledIframeHtml(el, 'position:absolute;width:4in;height:1in',
      { designW: 1.0, designH: 0.5, offsetX: 1.0, offsetY: 0, scale: 2 }, 'in');
    expect(out).toContain('width:1in;height:0.5in;');
    expect(out).toContain('transform:translate(1in,0in) scale(2);');   // ratio unchanged
  });
});
