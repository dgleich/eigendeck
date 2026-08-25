// Security: the shared export builders (image / cover / arrow) splice element values
// into a quoted attribute/style that becomes part of a self-contained (possibly
// hosted) HTML artifact. A crafted property must not create a new attribute/tag, and
// an exported href/src must not carry a `javascript:` URL (audit C-2 export builders).
import { describe, it, expect } from 'vitest';
// @ts-ignore — pure JS modules shared with the CLI/export
import { imageHtml, coverHtml, arrowSvgHtml } from './elementHtml.mjs';
// @ts-ignore
import { safeExportUrl, escAttr } from './htmlEscape.mjs';

const len = (n: number) => `${n}px`;
const PAYLOAD = '0"><img src=x onerror=EXPORT_XSS>';
const inertOnly = (html: string) => {
  // No injected <img ... onerror> tag; the payload survives only as escaped text.
  expect(html).not.toContain('<img src=x onerror');
  expect(html).toContain('&lt;img');
};

describe('elementHtml builders escape crafted values', () => {
  it('imageHtml — crafted rotation and src', () => {
    inertOnly(imageHtml(`data:${PAYLOAD}`, { position: { x: 0, y: 0, width: 10, height: 10 }, rotation: PAYLOAD } as never, len));
  });
  it('imageHtml — crafted opacity / borderRadius', () => {
    const out = imageHtml('data:image/png;base64,AAAA', { position: { x: 0, y: 0, width: 10, height: 10 }, opacity: PAYLOAD, borderRadius: PAYLOAD } as never, len);
    inertOnly(out);
  });
  it('coverHtml — crafted color', () => {
    inertOnly(coverHtml({ position: { x: 0, y: 0, width: 10, height: 10 }, color: PAYLOAD } as never, '#fff', len));
  });
  it('arrowSvgHtml — crafted strokeWidth / color', () => {
    inertOnly(arrowSvgHtml({ x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: PAYLOAD, color: PAYLOAD } as never, {}));
  });
  it('leaves legit values byte-identical (WYSIWYG)', () => {
    const out = imageHtml('data:image/png;base64,AAAA', { position: { x: 5, y: 6, width: 100, height: 80 }, opacity: 0.5, borderRadius: 8 } as never, len);
    expect(out).toContain('left:5px');
    expect(out).toContain('opacity:0.5');
    expect(out).toContain('border-radius:8px');
    expect(out).not.toContain('&');
  });
});

describe('safeExportUrl — URL scheme policy', () => {
  it('keeps http/https, upgrades protocol-relative, drops everything else', () => {
    expect(safeExportUrl('https://youtu.be/x')).toBe('https://youtu.be/x');
    expect(safeExportUrl('http://example.com')).toBe('http://example.com');
    expect(safeExportUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
    for (const bad of ['javascript:alert(1)', 'vbscript:x', 'file:///etc/passwd', 'data:text/html,<script>', '  javascript:x', 'nonsense']) {
      expect(safeExportUrl(bad)).toBe('');
    }
    expect(safeExportUrl('data:image/png;base64,AAAA', { allowData: true })).toContain('data:image/png');
  });
});
