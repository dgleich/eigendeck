import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from './sanitizeHtml';

// A representative MathJax-style SVG fragment: <defs> + <path> glyphs referenced
// by <use xlink:href="#…"> inside <g> transforms. The sanitizer MUST preserve
// all of this or math renders blank.
const MATHJAX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="5ex" height="2ex" viewBox="0 -750 2000 1000" role="img" focusable="false" style="vertical-align:-0.25ex">
  <defs><path id="E1-MJMATHI-3BB" d="M166 673Q166 685 183 694H202Z"/></defs>
  <g stroke="currentColor" fill="currentColor" stroke-width="0">
    <use xlink:href="#E1-MJMATHI-3BB" transform="translate(0,0)"/>
  </g>
</svg>`;

describe('sanitizeSvg', () => {
  it('preserves the structural pieces MathJax needs', async () => {
    const out = await sanitizeSvg(MATHJAX_SVG);
    expect(out).toContain('<svg');
    expect(out).toContain('viewBox="0 -750 2000 1000"');
    expect(out.toLowerCase()).toContain('<defs');
    expect(out).toContain('<path');
    expect(out).toContain('d="M166 673Q166 685 183 694H202Z"');
    expect(out).toContain('<use');
    // the internal glyph reference (#id) must survive, else <use> shows nothing
    expect(out).toMatch(/href="#E1-MJMATHI-3BB"/);
    expect(out).toContain('<g');
    expect(out).toContain('fill="currentColor"');
  });

  it('strips <script> from a poisoned SVG', async () => {
    const out = await sanitizeSvg('<svg><script>fetch("//evil")</script><path d="M0 0"/></svg>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('evil');
    expect(out).toContain('<path'); // benign content still passes
  });

  it('strips event-handler attributes', async () => {
    const out = await sanitizeSvg('<svg><rect onload="steal()" width="1" height="1"/></svg>');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out).not.toContain('steal');
  });

  it('neutralizes <foreignObject> HTML injection', async () => {
    const out = await sanitizeSvg('<svg><foreignObject><img src=x onerror="pwn()"></foreignObject></svg>');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('pwn');
  });

  it('drops external <use> refs but keeps in-document fragment refs', async () => {
    const out = await sanitizeSvg('<svg><use xlink:href="https://evil.example/x.svg#a"/><use xlink:href="#ok"/></svg>');
    expect(out).not.toContain('evil.example');
    expect(out).toMatch(/href="#ok"/); // the safe fragment ref survives
  });

  it('returns empty string for empty input', async () => {
    expect(await sanitizeSvg('')).toBe('');
    expect(await sanitizeSvg(undefined)).toBe('');
    expect(await sanitizeSvg(null)).toBe('');
  });
});
