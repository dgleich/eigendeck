import { describe, it, expect } from 'vitest';
import { clipboardRepresentations } from './pasteAs';

const kinds = (types: string[]) => clipboardRepresentations(types).map((r) => r.kind);

describe('clipboardRepresentations', () => {
  it('maps macOS UTIs to representations', () => {
    expect(kinds(['public.png', 'public.utf8-plain-text'])).toEqual(['image', 'text']);
    expect(kinds(['com.adobe.pdf'])).toEqual(['pdf']);
    expect(kinds(['com.microsoft.image-svg-xml'])).toEqual(['svg']);
    expect(kinds(['public.html', 'public.rtf'])).toEqual(['html', 'text']);
  });

  it('maps web MIME types to representations', () => {
    expect(kinds(['image/png', 'text/html', 'text/plain'])).toEqual(['image', 'html', 'text']);
    expect(kinds(['image/svg+xml'])).toEqual(['svg']);
    expect(kinds(['application/pdf'])).toEqual(['pdf']);
  });

  it('is case-insensitive', () => {
    expect(kinds(['IMAGE/PNG', 'Public.HTML'])).toEqual(['image', 'html']);
  });

  it('returns representations in a stable order (image, svg, pdf, html, text)', () => {
    // Regardless of input order, output follows the KINDS declaration order.
    expect(kinds(['text/plain', 'public.html', 'application/pdf', 'image/svg+xml', 'public.png']))
      .toEqual(['image', 'svg', 'pdf', 'html', 'text']);
  });

  it('de-duplicates a representation with several aliases present', () => {
    // png + jpeg both map to `image` → one entry.
    expect(kinds(['public.png', 'public.jpeg', 'image/png'])).toEqual(['image']);
  });

  it('offers a label for each representation', () => {
    const reps = clipboardRepresentations(['public.png', 'public.html', 'text/plain']);
    expect(reps).toEqual([
      { kind: 'image', label: 'Image' },
      { kind: 'html', label: 'HTML element' },
      { kind: 'text', label: 'Text' },
    ]);
  });

  it('empty / unknown types → no representations', () => {
    expect(kinds([])).toEqual([]);
    expect(kinds(['com.apple.icns', 'org.chromium.web-custom-data'])).toEqual([]);
  });
});
