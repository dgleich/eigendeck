import { describe, it, expect } from 'vitest';
import { looksLikeRichHtml, sanitizeForCapture } from './htmlPasteCapture';

describe('looksLikeRichHtml', () => {
  it('detects block/structured HTML', () => {
    expect(looksLikeRichHtml('<table><tr><td>a</td></tr></table>')).toBe(true);
    expect(looksLikeRichHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeRichHtml('<h2>Title</h2>')).toBe(true);
    expect(looksLikeRichHtml('<div><p>hi</p></div>')).toBe(true);
  });
  it('ignores bare inline / empty', () => {
    expect(looksLikeRichHtml('<span>just text</span>')).toBe(false);
    expect(looksLikeRichHtml('plain')).toBe(false);
    expect(looksLikeRichHtml('')).toBe(false);
    expect(looksLikeRichHtml(null)).toBe(false);
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
});
