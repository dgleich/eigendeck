import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  htmlNeedsScreenshot,
  extractPastedDataUrlImage,
  sanitizeForCapture,
  captureHtmlToPng,
} from './htmlPasteCapture';

// Mock the rasterizer boundary. captureHtmlToPng does a dynamic
// `import('modern-screenshot')`; we control its single export here.
const domToDataUrl = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock('modern-screenshot', () => ({ domToDataUrl: (...a: unknown[]) => domToDataUrl(...a) }));

// A 1x1 PNG (bytes don't matter for the tests, only that atob decodes it).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('htmlNeedsScreenshot', () => {
  it('returns false for empty / nullish input', () => {
    expect(htmlNeedsScreenshot('')).toBe(false);
    expect(htmlNeedsScreenshot(null)).toBe(false);
    expect(htmlNeedsScreenshot(undefined)).toBe(false);
  });

  it('screenshots structural elements a text box cannot hold', () => {
    for (const tag of ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'svg', 'figure', 'pre', 'math']) {
      expect(htmlNeedsScreenshot(`<${tag}>x</${tag}>`)).toBe(true);
    }
  });

  it('matches a structural tag with attributes (space after tag name)', () => {
    expect(htmlNeedsScreenshot('<table border="1"><tr><td>a</td></tr></table>')).toBe(true);
    expect(htmlNeedsScreenshot('<svg width="10"></svg>')).toBe(true);
  });

  it('is case-insensitive on tag names', () => {
    expect(htmlNeedsScreenshot('<TABLE><TR><TD>a</TD></TR></TABLE>')).toBe(true);
    expect(htmlNeedsScreenshot('<SVG></SVG>')).toBe(true);
  });

  it('does NOT screenshot editable rich text (p/div/span/headings/lists/formatting)', () => {
    expect(htmlNeedsScreenshot('<p>hello <b>world</b></p>')).toBe(false);
    expect(htmlNeedsScreenshot('<div><span style="color:red">x</span></div>')).toBe(false);
    expect(htmlNeedsScreenshot('<h1>Title</h1>')).toBe(false);
    expect(htmlNeedsScreenshot('<ul><li>one</li><li>two</li></ul>')).toBe(false);
    expect(htmlNeedsScreenshot('<i>italic</i>')).toBe(false);
  });

  it('does NOT falsely match a tag name embedded in a longer word', () => {
    // "tablet" / "prefix" must not trip the table/pre patterns.
    expect(htmlNeedsScreenshot('<tablet>x</tablet>')).toBe(false);
    expect(htmlNeedsScreenshot('<prefix>x</prefix>')).toBe(false);
  });

  it('screenshots an embedded data: image', () => {
    expect(htmlNeedsScreenshot('<img src="data:image/png;base64,AAAA">')).toBe(true);
    expect(htmlNeedsScreenshot("<img alt='q' src='data:image/gif;base64,AAAA'>")).toBe(true);
    // whitespace/no-quote variants the regex explicitly allows
    expect(htmlNeedsScreenshot('<img src= data:image/png;base64,AA>')).toBe(true);
  });

  it('does NOT screenshot a remote <img> (sanitizeForCapture strips it later)', () => {
    expect(htmlNeedsScreenshot('<img src="https://example.com/a.png">')).toBe(false);
    expect(htmlNeedsScreenshot('<p>text <img src="http://x/y.jpg"> more</p>')).toBe(false);
  });
});

describe('extractPastedDataUrlImage', () => {
  it('returns null for empty / nullish input', () => {
    expect(extractPastedDataUrlImage('')).toBeNull();
    expect(extractPastedDataUrlImage(null)).toBeNull();
    expect(extractPastedDataUrlImage(undefined)).toBeNull();
  });

  it('returns null when there is no data-URL image', () => {
    expect(extractPastedDataUrlImage('<p>just text</p>')).toBeNull();
    expect(extractPastedDataUrlImage('<img src="https://example.com/a.png">')).toBeNull();
  });

  it('extracts mime + decoded bytes from a data-URL <img>', () => {
    const out = extractPastedDataUrlImage(`<img src="data:image/png;base64,${PNG_1x1}">`);
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/png');
    // PNG magic number
    expect(Array.from(out!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('pulls the FIRST embedded image out of a Google-Slides-style wrapper', () => {
    const html =
      `<b docs-internal-guid="x"><img src="data:image/png;base64,${PNG_1x1}">` +
      `<img src="data:image/png;base64,${PNG_1x1}"></b>`;
    const out = extractPastedDataUrlImage(html);
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/png');
  });

  it('accepts single-quoted src and other image subtypes', () => {
    const out = extractPastedDataUrlImage(`<img alt='p' src='data:image/jpeg;base64,${PNG_1x1}'>`);
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/jpeg');
  });

  it('tolerates whitespace inside the base64 payload (strips it before decode)', () => {
    const chunked = PNG_1x1.replace(/(.{8})/g, '$1\n');
    const out = extractPastedDataUrlImage(`<img src="data:image/png;base64,${chunked}">`);
    expect(out).not.toBeNull();
    expect(out!.bytes.length).toBeGreaterThan(0);
  });

  it('returns null on malformed base64 (atob throws)', () => {
    // A single stray char makes the length invalid → atob throws → caught → null.
    const out = extractPastedDataUrlImage('<img src="data:image/png;base64,A">');
    expect(out).toBeNull();
  });

  it('returns null when the payload decodes to zero bytes', () => {
    const out = extractPastedDataUrlImage('<img src="data:image/png;base64,">');
    expect(out).toBeNull();
  });

  it('does not match a non-image data URL', () => {
    expect(extractPastedDataUrlImage('<img src="data:text/plain;base64,AAAA">')).toBeNull();
  });
});

describe('sanitizeForCapture', () => {
  it('drops script/style/link/meta/iframe/object/embed and other head noise', () => {
    const out = sanitizeForCapture(
      '<style>@import url(https://x/f.css)</style>' +
        '<script>evil()</script>' +
        '<iframe src="https://x"></iframe>' +
        '<object></object><embed>' +
        '<p>keep me</p>',
    );
    expect(out).toContain('keep me');
    expect(out).not.toMatch(/script|iframe|object|embed|@import/i);
  });

  it('removes remote <img> but keeps a data: <img>', () => {
    const out = sanitizeForCapture(
      '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA">',
    );
    expect(out).not.toContain('https://example.com/a.png');
    expect(out).toContain('data:image/png;base64');
  });

  it('removes an <img> with no src at all', () => {
    const out = sanitizeForCapture('<p>t</p><img>');
    expect(out).not.toContain('<img');
  });

  it('strips on* event-handler attributes', () => {
    const out = sanitizeForCapture('<div onclick="boom()" onmouseover="x()">hi</div>');
    expect(out).not.toMatch(/onclick|onmouseover/i);
    expect(out).toContain('hi');
  });

  it('strips javascript: href / src URLs', () => {
    const out = sanitizeForCapture('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('link');
  });

  it('keeps a benign href', () => {
    const out = sanitizeForCapture('<a href="https://example.com">link</a>');
    expect(out).toContain('https://example.com');
  });

  it('strips inline font-family so the deck font applies', () => {
    const out = sanitizeForCapture('<span style="font-family:Comic Sans; color:red">x</span>');
    expect(out.toLowerCase()).not.toContain('comic sans');
    // other formatting survives
    expect(out.toLowerCase()).toContain('color');
  });

  it('strips inline style props that reference a remote url()', () => {
    const out = sanitizeForCapture(
      '<div style="background-image:url(https://x/bg.png); color:blue">x</div>',
    );
    expect(out).not.toMatch(/https?:\/\/x\/bg\.png/);
    expect(out.toLowerCase()).toContain('color');
  });

  it('returns body innerHTML for plain content', () => {
    expect(sanitizeForCapture('<p>hello</p>')).toContain('hello');
  });
});

describe('captureHtmlToPng', () => {
  beforeEach(() => {
    domToDataUrl.mockReset();
    // rAF + fonts.ready are awaited inside the function.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a PNG payload with rounded content dimensions', async () => {
    domToDataUrl.mockResolvedValue(`data:image/png;base64,${PNG_1x1}`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320.6,
      height: 120.2,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const out = await captureHtmlToPng('<p>hi</p>', { fontFamily: 'PT Sans' });
    expect(out).not.toBeNull();
    expect(out!.width).toBe(321);
    expect(out!.height).toBe(120);
    expect(Array.from(out!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(domToDataUrl).toHaveBeenCalledTimes(1);
  });

  it('passes the requested scale/maxWidth and a network-blocking fetchFn', async () => {
    domToDataUrl.mockResolvedValue(`data:image/png;base64,${PNG_1x1}`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10,
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect);

    await captureHtmlToPng('<p>hi</p>', { fontFamily: 'Lato', scale: 2, maxWidth: 900 });
    const opts = domToDataUrl.mock.calls[0][1] as { scale: number; fetchFn: () => Promise<unknown> };
    expect(opts.scale).toBe(2);
    // fetchFn must refuse every remote fetch (returns false).
    await expect(opts.fetchFn()).resolves.toBe(false);
  });

  it('returns null when the rendered content has no area', async () => {
    domToDataUrl.mockResolvedValue(`data:image/png;base64,${PNG_1x1}`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 0,
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect);

    const out = await captureHtmlToPng('<p>hi</p>', { fontFamily: 'sans-serif' });
    expect(out).toBeNull();
    expect(domToDataUrl).not.toHaveBeenCalled();
  });

  it('returns null and warns when the rasterizer throws', async () => {
    domToDataUrl.mockRejectedValue(new Error('boom'));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 50,
      height: 50,
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = await captureHtmlToPng('<p>hi</p>', { fontFamily: 'sans-serif' });
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('removes the offscreen container after a successful capture', async () => {
    domToDataUrl.mockResolvedValue(`data:image/png;base64,${PNG_1x1}`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 20,
      height: 20,
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect);
    const before = document.body.children.length;
    await captureHtmlToPng('<p>hi</p>', { fontFamily: 'sans-serif' });
    expect(document.body.children.length).toBe(before);
  });
});
