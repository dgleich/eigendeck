// #79 regression: a text element's box must CLIP overflowing content (present
// mode entered the element through an opacity-fade buffer clipped to the box, so
// overflow "popped in" late). The fix clips the outer svg/foreignObject/box in
// the shared buildTextElementSvgMarkup. Guard that it stays clipped — and that
// the clip is the OUTER box only (the inner MathJax <svg> keeps overflow:visible
// for italic/integral glyph ink, #61 — that lives in mathjaxRenderer.ts, not
// here, so this builder must never emit overflow:visible).
import { describe, it, expect } from 'vitest';
import { buildTextElementSvgMarkup } from './TextElementSvg';
import { applyCodeFont } from '../lib/textStyle.mjs';

describe('applyCodeFont — gives <code> the deck mono family', () => {
  const MONO = "'Source Code Pro', monospace";
  it('adds font-family to a bare <code>', () => {
    expect(applyCodeFont('a <code>x=1</code> b', MONO))
      .toBe(`a <code style="font-family:${MONO}">x=1</code> b`);
  });
  it('appends to an existing style without clobbering it', () => {
    expect(applyCodeFont('<code style="color: red">x</code>', MONO))
      .toBe(`<code style="color: red;font-family:${MONO}">x</code>`);
  });
  it('is a no-op without a mono family or html', () => {
    expect(applyCodeFont('<code>x</code>', undefined)).toBe('<code>x</code>');
    expect(applyCodeFont('', MONO)).toBe('');
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const el: any = {
  id: 't', type: 'text', preset: 'body',
  html: '<div>Line one</div><div>Line two overflowing the box</div>',
  position: { x: 0, y: 0, width: 400, height: 80 },
};
const ctx = { fontFamily: 'PT Sans', fontSize: 32, fontWeight: '400', fontStyle: 'normal', color: '#222' };

describe('buildTextElementSvgMarkup — clips overflow to the box (#79)', () => {
  const svg = buildTextElementSvgMarkup(el, el.html, ctx);

  it('outer <svg> clips via BOTH the presentation attribute and CSS', () => {
    // WebKit only honors the overflow="hidden" attribute on <svg>/<foreignObject>;
    // CSS alone is overridden. Require both, mirroring how the fix was applied.
    expect(svg).toMatch(/<svg\b[^>]*\boverflow="hidden"/);
    expect(svg).toMatch(/<svg\b[^>]*style="[^"]*overflow:hidden/);
  });

  it('<foreignObject> clips', () => {
    expect(svg).toMatch(/<foreignObject\b[^>]*\boverflow="hidden"/);
  });

  it('the box <div> clips', () => {
    expect(svg).toMatch(/overflow:hidden;box-sizing:border-box/);
  });

  it('NEVER emits overflow:visible on the outer box (the #79 regression)', () => {
    expect(svg).not.toContain('overflow:visible');
    expect(svg).not.toMatch(/overflow="visible"/);
  });
});
