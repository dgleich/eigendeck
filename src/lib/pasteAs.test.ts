import { describe, it, expect } from 'vitest';
import { clipboardRepresentations } from './pasteAs';

const kinds = (types: string[]) => clipboardRepresentations(types).map((r) => r.kind);

describe('clipboardRepresentations', () => {
  it('maps macOS UTIs to representations', () => {
    expect(kinds(['public.png', 'public.utf8-plain-text'])).toEqual(['image', 'text']);
    expect(kinds(['com.adobe.pdf'])).toEqual(['pdf']);
    expect(kinds(['com.microsoft.image-svg-xml'])).toEqual(['svg']);
    expect(kinds(['public.html', 'public.rtf'])).toEqual(['html-image', 'html', 'text']);
  });

  it('maps web MIME types to representations', () => {
    // html + text present → "Simple Image" (rasterize) is also offered.
    expect(kinds(['image/png', 'text/html', 'text/plain'])).toEqual(['image', 'html-image', 'html', 'text']);
    expect(kinds(['image/svg+xml'])).toEqual(['svg']);
    expect(kinds(['application/pdf'])).toEqual(['pdf']);
  });

  it('is case-insensitive', () => {
    // Only html (no text) → no Simple Image.
    expect(kinds(['IMAGE/PNG', 'Public.HTML'])).toEqual(['image', 'html']);
  });

  it('offers "Simple Image" (html-image) only when BOTH html and text are present', () => {
    expect(kinds(['text/html', 'text/plain'])).toEqual(['html-image', 'html', 'text']);
    expect(kinds(['text/html'])).toEqual(['html']);          // html alone → no rasterize option
    expect(kinds(['text/plain'])).toEqual(['text']);          // text alone → no rasterize option
    expect(kinds(['public.html', 'public.utf8-plain-text'])).toEqual(['html-image', 'html', 'text']);
  });

  it('returns representations in a stable order (image, svg, pdf, html-image, html, text)', () => {
    // Regardless of input order, output follows the KINDS declaration order.
    expect(kinds(['text/plain', 'public.html', 'application/pdf', 'image/svg+xml', 'public.png']))
      .toEqual(['image', 'svg', 'pdf', 'html-image', 'html', 'text']);
  });

  it('de-duplicates a representation with several aliases present', () => {
    // png + jpeg both map to `image` → one entry.
    expect(kinds(['public.png', 'public.jpeg', 'image/png'])).toEqual(['image']);
  });

  it('offers a label for each representation', () => {
    const reps = clipboardRepresentations(['public.png', 'public.html', 'text/plain']);
    expect(reps).toEqual([
      { kind: 'image', label: 'Image' },
      { kind: 'html-image', label: 'Simple Image' },
      { kind: 'html', label: 'HTML element' },
      { kind: 'text', label: 'Text' },
    ]);
  });

  it('empty / unknown types → no representations', () => {
    expect(kinds([])).toEqual([]);
    expect(kinds(['com.apple.icns', 'org.chromium.web-custom-data'])).toEqual([]);
  });
});
