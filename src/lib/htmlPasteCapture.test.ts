import { describe, it, expect } from 'vitest';
import { htmlNeedsScreenshot, sanitizeForCapture, extractPastedDataUrlImage } from './htmlPasteCapture';

describe('extractPastedDataUrlImage (#158 Google Slides)', () => {
  // 1x1 transparent PNG
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  // Exactly the shape Google Slides puts on text/html (see issue #158).
  const gslides = `<b id="docs-internal-guid-5400a67e-7fff-4cf0-ed00-dfea257517fc" style="caret-color: rgb(0, 0, 0); font-weight: normal;"><img width="754px;" height="568px;" src="data:image/png;base64,${PNG_B64}"></b>`;

  it('pulls the embedded PNG out of a Google Slides paste', () => {
    const r = extractPastedDataUrlImage(gslides);
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('image/png');
    // decodes to the real PNG signature
    expect([...r!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('handles single-quoted src and jpeg', () => {
    const r = extractPastedDataUrlImage(`<img src='data:image/jpeg;base64,${PNG_B64}'>`);
    expect(r!.mime).toBe('image/jpeg');
  });

  it('returns null when there is no data-URL image', () => {
    expect(extractPastedDataUrlImage('<table><tr><td>x</td></tr></table>')).toBeNull();
    expect(extractPastedDataUrlImage('<img src="https://example.com/x.png">')).toBeNull();
    expect(extractPastedDataUrlImage('')).toBeNull();
    expect(extractPastedDataUrlImage(null)).toBeNull();
  });

  it('returns null on malformed base64', () => {
    expect(extractPastedDataUrlImage('<img src="data:image/png;base64,@@@notbase64@@@">')).toBeNull();
  });
});

describe('htmlNeedsScreenshot', () => {
  it('screenshots structure a text box cannot represent (tables, images, preformatted)', () => {
    expect(htmlNeedsScreenshot('<table><tr><td>a</td></tr></table>')).toBe(true);
    expect(htmlNeedsScreenshot('<img src="data:image/png;base64,AAAA">')).toBe(true);
    expect(htmlNeedsScreenshot('<pre>  code</pre>')).toBe(true);
  });
  it('does NOT screenshot text a text box CAN represent (paragraphs, styling, lists, headings)', () => {
    // Word/browsers wrap even a one-line styled sentence in <p>/<div> — must be editable text (#161).
    expect(htmlNeedsScreenshot('<div><p>Here is <b>some</b> text.</p></div>')).toBe(false);
    expect(htmlNeedsScreenshot('<ul><li>x</li></ul>')).toBe(false);
    expect(htmlNeedsScreenshot('<h2>Title</h2>')).toBe(false);
    expect(htmlNeedsScreenshot('<span style="color:red">just text</span>')).toBe(false);
    expect(htmlNeedsScreenshot('plain')).toBe(false);
    expect(htmlNeedsScreenshot('')).toBe(false);
    expect(htmlNeedsScreenshot(null)).toBe(false);
  });
  it('does NOT screenshot a REMOTE <img> (stripped in capture) → text; DOES for a data: image', () => {
    expect(htmlNeedsScreenshot('<p>caption <img src="https://example.com/pic.png"></p>')).toBe(false);
    expect(htmlNeedsScreenshot('<p>x <img src="data:image/png;base64,AAAA"></p>')).toBe(true);
  });
});

describe('sanitizeForCapture', () => {
  it('strips scripts, handlers, and javascript: urls', () => {
    const out = sanitizeForCapture(
      `<div><script>alert(1)</script><a href="javascript:evil()" onclick="x()">hi</a></div>`,
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('hi');
  });

  it('strips font-family (deck font becomes default) but keeps other styling', () => {
    const out = sanitizeForCapture(
      `<table><tr><td style="font-family: 'Roboto Mono'; font-weight: 700; color: rgb(1,2,3); border: 1px solid rgb(0,0,0);">x</td></tr></table>`,
    );
    expect(out).not.toMatch(/font-family/i);
    expect(out).toMatch(/font-weight/i);
    expect(out).toContain('rgb(1, 2, 3)');
    expect(out).toMatch(/border/i);
    expect(out).toContain('>x<');
  });

  it('drops embeds (iframe/object/embed)', () => {
    const out = sanitizeForCapture('<div><iframe src="x"></iframe><p>ok</p></div>');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('ok');
  });

  it('removes REMOTE images + remote url() so the capture is network-free, keeps data: images', () => {
    const out = sanitizeForCapture(
      '<div><img src="https://x/a.png"><img src="data:image/png;base64,AAAA">' +
      '<p style="background-image:url(https://x/bg.png);color:red">hi</p></div>',
    );
    expect(out).not.toContain('https://x/a.png');       // remote img removed
    expect(out).toContain('data:image/png;base64,AAAA'); // data: img kept
    expect(out.toLowerCase()).not.toContain('https://x/bg.png'); // remote bg url stripped
    expect(out.toLowerCase()).toContain('color');        // other inline styles kept
    expect(out).toContain('hi');
  });

  it('drops <style> blocks (remote @font-face / @import hang risk)', () => {
    const out = sanitizeForCapture('<div><style>@font-face{font-family:x;src:url(https://x/f.woff2)}</style><p>ok</p></div>');
    expect(out).not.toContain('<style');
    expect(out.toLowerCase()).not.toContain('font-face');
    expect(out).toContain('ok');
  });
});
