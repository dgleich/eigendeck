import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  mathCacheKey,
  containsMath,
  texFromHtml,
  renderMathInHtmlSync,
  warmMathCacheFromSqlite,
  resetMathCacheWarmupFlag,
} from './mathjaxRenderer';

// The `@tauri-apps/api/core` module is auto-mocked in src/test/setup.ts, so
// `invoke` here is a vi.fn() we can drive per-test.
const mockInvoke = vi.mocked(invoke);

type CacheRow = {
  key: string;
  tex: string;
  bundle: string;
  display: boolean;
  preamble: string;
  svg: string;
  width: string | null;
  height: string | null;
  valign: string | null;
};

function row(overrides: Partial<CacheRow> & Pick<CacheRow, 'tex' | 'bundle' | 'display'>): CacheRow {
  const preamble = overrides.preamble ?? '';
  return {
    key: mathCacheKey(overrides.tex, overrides.bundle, overrides.display, preamble),
    preamble,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0h10"/></svg>',
    width: '1.2ex',
    height: '2.0ex',
    valign: '-0.5ex',
    ...overrides,
  };
}

beforeEach(() => {
  // Clears warmCacheLoaded AND every in-memory pool cache so tests don't bleed.
  resetMathCacheWarmupFlag();
  mockInvoke.mockReset();
});

describe('mathCacheKey', () => {
  it('produces a stable 8-char lowercase hex hash', () => {
    const k = mathCacheKey('x^2', 'lato', false, '');
    expect(k).toMatch(/^[0-9a-f]{8}$/);
    // deterministic
    expect(mathCacheKey('x^2', 'lato', false, '')).toBe(k);
  });

  it('varies with each input dimension (tex, bundle, display, preamble)', () => {
    const base = mathCacheKey('x^2', 'lato', false, '');
    expect(mathCacheKey('x^3', 'lato', false, '')).not.toBe(base);
    expect(mathCacheKey('x^2', 'noto-sans', false, '')).not.toBe(base);
    expect(mathCacheKey('x^2', 'lato', true, '')).not.toBe(base);
    expect(mathCacheKey('x^2', 'lato', false, '\\newcommand{\\R}{\\mathbb{R}}')).not.toBe(base);
  });

  it('is not confused by dimension-boundary shuffling (uses a delimiter)', () => {
    // "a" + bundle "b" must not collide with tex "" + bundle "ab" etc.
    expect(mathCacheKey('a', 'b', false, '')).not.toBe(mathCacheKey('', 'ab', false, ''));
  });
});

describe('containsMath', () => {
  it('detects inline and display math', () => {
    expect(containsMath('the value $x^2$ here')).toBe(true);
    expect(containsMath('centered $$\\sum_{i=1}^n i$$ end')).toBe(true);
    expect(containsMath('$a$')).toBe(true);
    // a single space between delimiters is still a match
    expect(containsMath('$ $')).toBe(true);
  });

  it('rejects text with no closed math span', () => {
    expect(containsMath('no math at all')).toBe(false);
    expect(containsMath('a lone $ sign')).toBe(false);
    expect(containsMath('empty $$ pair')).toBe(false);
    expect(containsMath('empty $$$$ pair')).toBe(false);
    // inline math may not span a newline
    expect(containsMath('$a\nb$')).toBe(false);
  });
});

describe('texFromHtml', () => {
  it('strips inline formatting tags injected mid-expression', () => {
    expect(texFromHtml('x<font color="#dc2626">^2</font>')).toBe('x^2');
    expect(texFromHtml('<span style="color:red">\\lambda_1</span>')).toBe('\\lambda_1');
  });

  it('decodes HTML entities back to LaTeX punctuation', () => {
    expect(texFromHtml('a &lt; b &gt; c')).toBe('a < b > c');
    expect(texFromHtml('&quot;q&quot; and &#39;p&#39;')).toBe('"q" and \'p\'');
  });

  it('decodes &amp; LAST so &amp;lt; survives as a literal &lt;', () => {
    expect(texFromHtml('&amp;lt;')).toBe('&lt;');
    // a bare matrix/align ampersand
    expect(texFromHtml('A &amp; B')).toBe('A & B');
  });

  it('normalises nbsp variants to a plain space', () => {
    expect(texFromHtml('a&nbsp;b c')).toBe('a b c');
  });

  it('passes clean LaTeX through untouched', () => {
    expect(texFromHtml('\\sum_{i=1}^n i')).toBe('\\sum_{i=1}^n i');
  });
});

describe('renderMathInHtmlSync', () => {
  it('returns the input unchanged when there is no math', () => {
    expect(renderMathInHtmlSync('plain text', 'lato')).toBe('plain text');
  });

  it('returns null when the bundle has no pool yet', () => {
    // A bundle no other test ever warms → pools.get() misses → null.
    expect(renderMathInHtmlSync('has $x$ math', 'unpooled-bundle-xyz')).toBeNull();
  });

  it('splices cached inline + display SVGs and leaves misses as raw source', async () => {
    mockInvoke.mockResolvedValueOnce([
      row({ tex: 'x^2', bundle: 'lato', display: false }),
      row({ tex: 'S', bundle: 'lato', display: true }),
    ] as CacheRow[]);
    const n = await warmMathCacheFromSqlite();
    expect(n).toBe(2);

    const out = renderMathInHtmlSync('inline $x^2$ and $$S$$ and uncached $y$', 'lato');
    expect(out).not.toBeNull();
    const html = out as string;
    // inline hit → svg with injected vertical-align, no leftover delimiters
    expect(html).toContain('vertical-align:');
    expect(html).not.toContain('$x^2$');
    // display hit → centered div wrapper
    expect(html).toContain('<div style="text-align:center;">');
    expect(html).not.toContain('$$S$$');
    // uncached expression is left verbatim for the async pass to fill in
    expect(html).toContain('$y$');
  });

  it('does not treat math delimiters inside an HTML tag as math', async () => {
    mockInvoke.mockResolvedValueOnce([] as CacheRow[]);
    await warmMathCacheFromSqlite();
    // The $ lives inside an attribute; the tag is copied through verbatim.
    const out = renderMathInHtmlSync('<a title="$x$">real $y$ here</a>', 'lato');
    expect(out).not.toBeNull();
    expect(out as string).toContain('<a title="$x$">');
    // $y$ is real math but uncached, so it stays as source
    expect(out as string).toContain('$y$');
  });
});

describe('warmMathCacheFromSqlite', () => {
  it('loads rows into the pool cache and reports the count', async () => {
    mockInvoke.mockResolvedValueOnce([row({ tex: 'a', bundle: 'lato', display: false })] as CacheRow[]);
    expect(await warmMathCacheFromSqlite()).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_load_math_cache');
  });

  it('is one-shot: a second call short-circuits to 0 without re-querying', async () => {
    mockInvoke.mockResolvedValueOnce([row({ tex: 'a', bundle: 'lato', display: false })] as CacheRow[]);
    expect(await warmMathCacheFromSqlite()).toBe(1);
    expect(await warmMathCacheFromSqlite()).toBe(0);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('re-arms after resetMathCacheWarmupFlag()', async () => {
    mockInvoke.mockResolvedValueOnce([row({ tex: 'a', bundle: 'lato', display: false })] as CacheRow[]);
    expect(await warmMathCacheFromSqlite()).toBe(1);
    resetMathCacheWarmupFlag();
    mockInvoke.mockResolvedValueOnce([] as CacheRow[]);
    // flag re-armed → the query runs again
    expect(await warmMathCacheFromSqlite()).toBe(0);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('returns 0 and swallows a query failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('db closed'));
    expect(await warmMathCacheFromSqlite()).toBe(0);
  });

  it('sanitizes untrusted SVG from the DB before caching (drops <script>)', async () => {
    mockInvoke.mockResolvedValueOnce([
      row({
        tex: 'p',
        bundle: 'lato',
        display: false,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>',
      }),
    ] as CacheRow[]);
    await warmMathCacheFromSqlite();
    const out = renderMathInHtmlSync('go $p$ now', 'lato');
    expect(out).not.toBeNull();
    expect(out as string).not.toContain('<script>');
  });
});

describe('resetMathCacheWarmupFlag', () => {
  it('clears the in-memory pool cache so warmed math no longer resolves', async () => {
    mockInvoke.mockResolvedValueOnce([row({ tex: 'x^2', bundle: 'lato', display: false })] as CacheRow[]);
    await warmMathCacheFromSqlite();
    expect(renderMathInHtmlSync('$x^2$', 'lato')).not.toContain('$x^2$');

    resetMathCacheWarmupFlag();
    // pool still exists (not removed), but its cache was cleared → cache miss → raw source
    expect(renderMathInHtmlSync('$x^2$', 'lato')).toBe('$x^2$');
  });
});
