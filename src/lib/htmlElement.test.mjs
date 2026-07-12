import { describe, it, expect } from 'vitest';
import {
  htmlElementSrcdoc, htmlElementIframeHtml,
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
