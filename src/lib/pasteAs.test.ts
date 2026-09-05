import { describe, it, expect } from 'vitest';
import { clipboardRepresentations } from './pasteAs';

const kinds = (types: string[]) => clipboardRepresentations(types).map((r) => r.kind);

describe('clipboardRepresentations', () => {
  it('returns nothing for an empty or unknown clipboard', () => {
    expect(clipboardRepresentations([])).toEqual([]);
    expect(kinds(['application/x-whatever', 'com.acme.custom'])).toEqual([]);
  });

  it('maps a single graphics representation (native UTI or web MIME)', () => {
    expect(kinds(['public.png'])).toEqual(['image']);
    expect(kinds(['image/png'])).toEqual(['image']);
    expect(kinds(['image/jpeg'])).toEqual(['image']);
    expect(kinds(['public.svg-image'])).toEqual(['svg']);
    expect(kinds(['image/svg+xml'])).toEqual(['svg']);
    expect(kinds(['com.adobe.pdf'])).toEqual(['pdf']);
    expect(kinds(['application/pdf'])).toEqual(['pdf']);
  });

  it('collapses multiple aliases of the same kind to a single entry', () => {
    expect(kinds(['public.png', 'image/png', 'public.jpeg', 'image/tiff'])).toEqual(['image']);
  });

  it('is case-insensitive on the type tokens', () => {
    expect(kinds(['PUBLIC.PNG'])).toEqual(['image']);
    expect(kinds(['IMAGE/SVG+XML'])).toEqual(['svg']);
  });

  it('offers HTML alone (no Simple Image) when text is absent', () => {
    expect(kinds(['public.html'])).toEqual(['html']);
    expect(kinds(['text/html'])).toEqual(['html']);
  });

  it('offers Text alone', () => {
    expect(kinds(['text/plain'])).toEqual(['text']);
    expect(kinds(['public.utf8-plain-text'])).toEqual(['text']);
    expect(kinds(['text/rtf'])).toEqual(['text']);
  });

  it('offers Simple Image (html-image) ONLY when both HTML and text are present', () => {
    // rich copy (browser / Word / Docs): html + text → rasterize option appears
    expect(kinds(['text/html', 'text/plain'])).toEqual(['html-image', 'html', 'text']);
    // rtf counts as text for the "both" rule
    expect(kinds(['public.html', 'public.rtf'])).toEqual(['html-image', 'html', 'text']);
    // html without any text flavor → no html-image
    expect(kinds(['text/html'])).not.toContain('html-image');
  });

  it('orders richest-graphics-first, text last', () => {
    const all = ['public.png', 'image/svg+xml', 'application/pdf', 'text/html', 'text/plain'];
    expect(kinds(all)).toEqual(['image', 'svg', 'pdf', 'html-image', 'html', 'text']);
  });

  it('every returned rep carries a human label', () => {
    for (const r of clipboardRepresentations(['public.png', 'text/html', 'text/plain'])) {
      expect(typeof r.label).toBe('string');
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});
