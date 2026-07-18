import { describe, it, expect } from 'vitest';
import { pasteTextToElementHtml } from './pasteText';

describe('pasteTextToElementHtml (#161)', () => {
  it('keeps authorable styling from text/html (bold + color)', () => {
    const out = pasteTextToElementHtml('<b style="color:#c00">Hi</b>', 'Hi') || '';
    expect(out).toContain('Hi');
    expect(out.toLowerCase()).toContain('color');
    expect(out.toLowerCase()).toMatch(/<(b|strong)|font-weight/);
  });

  it('drops font-size and font-family from text/html (adopts the preset size)', () => {
    const out = pasteTextToElementHtml(
      '<span style="font-size:48px;font-family:Comic Sans;color:red">big</span>', 'big') || '';
    expect(out).toContain('big');
    expect(out.toLowerCase()).not.toContain('font-size');
    expect(out.toLowerCase()).not.toContain('48px');
    expect(out.toLowerCase()).not.toContain('font-family');
    expect(out.toLowerCase()).toContain('color'); // color survives
  });

  it('prefers text/html over text/plain when both are present', () => {
    const out = pasteTextToElementHtml('<i>styled</i>', 'plainfallback') || '';
    expect(out).toContain('styled');
    expect(out).not.toContain('plainfallback');
  });

  it('escapes text/plain and preserves line breaks', () => {
    expect(pasteTextToElementHtml(null, 'line1\nline2')).toBe('line1<br>line2');
    expect(pasteTextToElementHtml('', 'a\r\nb')).toBe('a<br>b'); // CRLF normalized
  });

  it('escapes HTML metacharacters in plain text (no tag injection)', () => {
    const out = pasteTextToElementHtml(null, 'a < b & <script>x</script>') || '';
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).not.toContain('<script>');
  });

  it('falls back to text/plain when the html sanitizes to empty (e.g. only an <img>)', () => {
    expect(pasteTextToElementHtml('<img src="data:image/png;base64,AAAA">', 'caption')).toBe('caption');
  });

  it('returns null when there is nothing usable', () => {
    expect(pasteTextToElementHtml('', '')).toBeNull();
    expect(pasteTextToElementHtml(null, null)).toBeNull();
    expect(pasteTextToElementHtml('   ', '  ')).toBeNull();
  });

  it('strips dangerous handlers/scripts from pasted html', () => {
    const out = pasteTextToElementHtml('<b onclick="evil()">x</b><script>bad()</script>', 'x') || '';
    expect(out).toContain('x');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('bad()');
  });
});
