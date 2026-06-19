// Regression test for the present-mode raw-LaTeX bug: the SVG cache key includes
// the preamble, so the WRITE path (renderMathInHtml → renderMath) and the READ
// path (renderMathInHtmlSync / warm-from-SQLite) only agree if BOTH key by the
// same preamble. The bug was the write keying under "" while the read used the
// real deck preamble → 100% miss → live re-render → cruft. These tests lock in
// that the preamble (and every other component) actually participates in the key.
import { describe, it, expect } from 'vitest';
import { mathCacheKey } from './mathjaxRenderer';

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
