import { describe, it, expect } from 'vitest';
import { validateHtmlSnippet, snippetIsInteractive } from './htmlSnippet';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('validateHtmlSnippet (#137)', () => {
  it('accepts a clean self-contained snippet', () => {
    const r = validateHtmlSnippet('<style>.x{color:red}</style><div class="x">hi</div>');
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.html).toContain('<div');
  });

  it('rejects an empty file', () => {
    expect(validateHtmlSnippet('   ').ok).toBe(false);
    expect(validateHtmlSnippet('').problems[0]).toMatch(/empty/i);
  });

  it('rejects non-HTML (plain text)', () => {
    const r = validateHtmlSnippet('just some words, no tags');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/doesn.t look like HTML/i);
  });

  it('rejects a <script>', () => {
    const r = validateHtmlSnippet('<div>ok</div><script>alert(1)</script>');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/script/i);
  });

  it('rejects inline event handlers', () => {
    const r = validateHtmlSnippet('<img src="data:," onerror="steal()"><div>x</div>');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/event handler/i);
  });

  it('rejects remote resources (img/css/link/@import)', () => {
    for (const bad of [
      '<img src="https://evil.example/x.png"><p>x</p>',
      '<div style="background:url(http://a/b.png)">x</div>',
      '<style>@import url(https://fonts.example/f.css);</style><p>x</p>',
      '<link rel="stylesheet" href="//cdn.example/a.css"><p>x</p>',
      '<img srcset="https://a/b.png 2x"><p>x</p>',
    ]) {
      const r = validateHtmlSnippet(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.problems.join(' ')).toMatch(/remote resources/i);
    }
  });

  it('allows inline styles and data: URIs', () => {
    const r = validateHtmlSnippet('<style>@font-face{src:url(data:font/woff2;base64,AA)}</style><img src="data:image/png;base64,AA"><b>x</b>');
    expect(r.ok).toBe(true);
  });

  it('reads the interactive flag from the metadata comment', () => {
    expect(snippetIsInteractive('<!-- eigendeck-html-element name="X" interactive --><div>x</div>')).toBe(true);
    expect(snippetIsInteractive('<!-- eigendeck-html-element name="X" --><div>x</div>')).toBe(false);
    expect(validateHtmlSnippet('<!-- eigendeck-html-element interactive --><input type="range"><b>x</b>').interactive).toBe(true);
  });

  it('rejects an over-size file', () => {
    const big = '<div>' + 'a'.repeat(2_000_001) + '</div>';
    expect(validateHtmlSnippet(big).problems.join(' ')).toMatch(/too large/i);
  });

  // The committed snippet library must always pass its own gate.
  it('every examples-html-elements/*.html snippet validates', () => {
    const dir = join(__dirname, '../../examples-html-elements');
    const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = validateHtmlSnippet(readFileSync(join(dir, f), 'utf8'));
      expect(r.ok, `${f}: ${r.problems.join('; ')}`).toBe(true);
    }
  });
});
