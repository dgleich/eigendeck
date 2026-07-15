import { describe, it, expect } from 'vitest';
import { sanitizeRichText, sanitizePresentationHtml } from './sanitizeRichText';

describe('sanitizeRichText — security', () => {
  it('strips event handlers (the real innerHTML vector)', () => {
    expect(sanitizeRichText('<img src=x onerror="alert(1)">')).toBe('');
    expect(sanitizeRichText('<span onclick="evil()">hi</span>')).toBe('<span>hi</span>');
    // svg/onload is a classic auto-run vector
    expect(sanitizeRichText('<svg onload="alert(1)"></svg>')).toBe('');
  });

  it('drops script/iframe/embed subtrees entirely', () => {
    expect(sanitizeRichText('a<script>steal()</script>b')).toBe('ab');
    expect(sanitizeRichText('<iframe src="http://x"></iframe>')).toBe('');
  });

  it('strips javascript: and url() from styles', () => {
    expect(sanitizeRichText('<span style="color:red;background:url(javascript:x)">t</span>'))
      .toBe('<span style="color: red">t</span>');
  });
});

describe('sanitizeRichText — whitespace normalization', () => {
  // The editor (WebKit contentEditable) silently inserts &nbsp; while you type.
  // In edit mode WebKit's -webkit-nbsp-mode:space treats those as breakable, so
  // text wraps cleanly; every OUTPUT path (SVG foreignObject / export / PDF)
  // honors them as non-breaking and wraps raggedly — a WYSIWYG divergence (#159).
  // Normalize the artifact nbsp to a regular, breakable space on every ingest.
  it('normalizes &nbsp; to a regular breakable space', () => {
    expect(sanitizeRichText('a&nbsp;b')).toBe('a b');
    expect(sanitizeRichText('note.&nbsp;Okay')).toBe('note. Okay');
    // the actual non-breaking-space character, not just the entity
    expect(sanitizeRichText('x\u00A0y')).toBe('x y');
    // inside allowed markup too
    expect(sanitizeRichText('<b>a&nbsp;b</b>')).toBe('<b>a b</b>');
  });
});

describe('sanitizeRichText — toolbar allowlist', () => {
  it('keeps the formatting the toolbar produces', () => {
    expect(sanitizeRichText('<b>a</b><i>b</i><s>c</s>')).toBe('<b>a</b><i>b</i><s>c</s>');
    expect(sanitizeRichText('<span style="color: #2563eb">x</span>')).toBe('<span style="color: #2563eb">x</span>');
    expect(sanitizeRichText('<span style="text-transform: uppercase; letter-spacing: 0.08em">x</span>'))
      .toBe('<span style="text-transform: uppercase; letter-spacing: 0.08em">x</span>');
    expect(sanitizeRichText('<ul><li>one</li><li>two</li></ul>')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(sanitizeRichText('<div style="text-align: center">c</div>')).toBe('<div style="text-align: center">c</div>');
    expect(sanitizeRichText('<font color="#ff0000">r</font>')).toBe('<font color="#ff0000">r</font>');
    expect(sanitizeRichText('run <code>T(n)=2T(n/2)</code> here')).toBe('run <code>T(n)=2T(n/2)</code> here');
  });

  it('drops styles the toolbar cannot make (font-size, background, margin, padding)', () => {
    expect(sanitizeRichText('<div style="font-size: 32px; color: red">x</div>'))
      .toBe('<div style="color: red">x</div>');
    expect(sanitizeRichText('<div style="background: #eef; border-radius: 12px; padding: 20px">x</div>'))
      .toBe('<div>x</div>');
    expect(sanitizeRichText('<div style="margin-bottom: 18px; font-weight: 700">L</div>'))
      .toBe('<div style="font-weight: 700">L</div>');
  });

  it('unwraps unknown tags but keeps their text', () => {
    expect(sanitizeRichText('<section><h1>Title</h1>body</section>')).toBe('Titlebody');
    expect(sanitizeRichText('<a href="http://x">link</a>')).toBe('link'); // no link button in toolbar
  });

  it('preserves $…$ / $$…$$ math source as plain text', () => {
    expect(sanitizeRichText('Let $A=U\\Sigma V^{\\top}$ be')).toBe('Let $A=U\\Sigma V^{\\top}$ be');
    expect(sanitizeRichText('<div>$$x^2$$</div>')).toBe('<div>$$x^2$$</div>');
  });

  it('is idempotent', () => {
    const once = sanitizeRichText('<div style="margin:4px;color:red"><b>x</b><script>e()</script></div>');
    expect(sanitizeRichText(once)).toBe(once);
  });

  it('returns empty for empty/nullish input', () => {
    expect(sanitizeRichText('')).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
    expect(sanitizeRichText(null)).toBe('');
  });
});

describe('sanitizePresentationHtml', () => {
  it('cleans every text element in place and reports change', () => {
    const p = {
      slides: [{
        elements: [
          { id: 'a', type: 'text', html: '<div style="padding:20px;color:red">hi</div>' },
          { id: 'b', type: 'image', html: undefined },
          { id: 'c', type: 'text', html: '<b>ok</b>' },
        ],
      }],
    };
    const changed = sanitizePresentationHtml(p);
    expect(changed).toBe(true);
    expect(p.slides[0].elements[0].html).toBe('<div style="color: red">hi</div>');
    expect(p.slides[0].elements[2].html).toBe('<b>ok</b>'); // already clean, untouched
  });

  it('returns false when nothing needs cleaning', () => {
    const p = { slides: [{ elements: [{ id: 'a', type: 'text', html: '<b>ok</b>' }] }] };
    expect(sanitizePresentationHtml(p)).toBe(false);
  });
});
