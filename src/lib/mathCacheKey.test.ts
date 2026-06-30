// Regression test for the present-mode raw-LaTeX bug: the SVG cache key includes
// the preamble, so the WRITE path (renderMathInHtml → renderMath) and the READ
// path (renderMathInHtmlSync / warm-from-SQLite) only agree if BOTH key by the
// same preamble. The bug was the write keying under "" while the read used the
// real deck preamble → 100% miss → live re-render → cruft. These tests lock in
// that the preamble (and every other component) actually participates in the key.
import { describe, it, expect } from 'vitest';
import { mathCacheKey, texFromHtml } from './mathjaxRenderer';

describe('mathCacheKey', () => {
  const tex = '\\bmat{a & b}';
  const preamble = '\\newcommand{\\bmat}[1]{\\begin{bmatrix}#1\\end{bmatrix}}';

  it('is deterministic for identical inputs (a write can be read back)', () => {
    expect(mathCacheKey(tex, 'ptsans', true, preamble))
      .toBe(mathCacheKey(tex, 'ptsans', true, preamble));
  });

  it('DIFFERENT preamble → DIFFERENT key (the bug: "" vs the real preamble)', () => {
    expect(mathCacheKey(tex, 'ptsans', true, ''))
      .not.toBe(mathCacheKey(tex, 'ptsans', true, preamble));
  });

  it('tex, bundle, and display each affect the key', () => {
    const base = mathCacheKey(tex, 'ptsans', true, preamble);
    expect(mathCacheKey(tex + ' ', 'ptsans', true, preamble)).not.toBe(base);
    expect(mathCacheKey(tex, 'lato', true, preamble)).not.toBe(base);
    expect(mathCacheKey(tex, 'ptsans', false, preamble)).not.toBe(base);
  });
});

// The "change colour mid-equation fails to render" bug: applying a colour over
// part of a $…$ expression makes contentEditable wrap a sub-range in a
// <font>/<span style="color:…"> tag, and that tag lands INSIDE the delimiters.
// texFromHtml must hand MathJax the clean LaTeX, AND derive the SAME tex the
// async write path used so the cache still hits (no flash, export matches).
describe('texFromHtml (math source extraction)', () => {
  it('strips a colour <font> tag that split the expression', () => {
    expect(texFromHtml('x<font color="#dc2626">^2</font>')).toBe('x^2');
  });

  it('strips a colour <span style> that split the expression', () => {
    expect(texFromHtml('\\lambda<span style="color:#dc2626">_1</span>')).toBe('\\lambda_1');
  });

  it('decodes HTML-escaped LaTeX relations and matrix/align &', () => {
    expect(texFromHtml('a &lt; b')).toBe('a < b');
    expect(texFromHtml('\\begin{matrix}a &amp; b\\end{matrix}')).toBe('\\begin{matrix}a & b\\end{matrix}');
  });

  it('leaves clean LaTeX untouched (no spurious changes → cache stays warm)', () => {
    expect(texFromHtml('\\sum_{i=1}^n \\alpha_i x_i^2')).toBe('\\sum_{i=1}^n \\alpha_i x_i^2');
  });

  it('the cleaned tex keys the cache, so a coloured expr still resolves to its SVG', () => {
    // What the write path stored vs. what the (corrupted) read slice produces —
    // both go through texFromHtml, so the keys must agree.
    const clean = mathCacheKey(texFromHtml('x^2'), 'ptsans', false, '');
    const colored = mathCacheKey(texFromHtml('x<font color="#dc2626">^2</font>'), 'ptsans', false, '');
    expect(colored).toBe(clean);
  });
});
