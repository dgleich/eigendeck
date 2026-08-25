// Security: buildTextElementSvgMarkup string-concatenates element properties into a
// quoted SVG style/attribute that is dangerouslySetInnerHTML'd in the PRIVILEGED
// frame. Every dynamic value must be escaped so a crafted property (padding,
// fontFamily, color, geometry — or a size from an unvalidated config.textSizes)
// cannot break out of the attribute and inject a tag (audit C-2 sink defense).
import { describe, it, expect } from 'vitest';
import { buildTextElementSvgMarkup } from './TextElementSvg';
import type { TextElement } from '../types/presentation';

const PAYLOAD = '"><img src=x onerror=alert(1)>';

function craft(over: Record<string, unknown>): TextElement {
  return {
    id: 'x', type: 'text', preset: 'body', html: 'hi',
    position: { x: 0, y: 0, width: 100, height: 50 }, ...over,
  } as unknown as TextElement;
}

const ctxOf = (over: Record<string, unknown> = {}) => ({
  fontFamily: "'PT Sans', sans-serif", fontSize: 48, fontWeight: 'normal',
  fontStyle: 'normal', color: '#000', ...over,
});

describe('buildTextElementSvgMarkup — property injection is escaped (C-2 sink)', () => {
  it('escapes a breakout in element.padding', () => {
    const out = buildTextElementSvgMarkup(
      craft({ padding: { top: PAYLOAD, right: 0, bottom: 0, left: 0 } }), 'hi', ctxOf());
    expect(out).not.toContain('<img'); // no real tag — it survives only as inert escaped text
    expect(out).toContain('&lt;img');
  });

  it('escapes a breakout in fontFamily / color / geometry', () => {
    for (const ctx of [ctxOf({ fontFamily: PAYLOAD }), ctxOf({ color: PAYLOAD })]) {
      const out = buildTextElementSvgMarkup(craft({}), 'hi', ctx);
      expect(out).not.toContain('<img');
      expect(out).toContain('&lt;img');
    }
    const outGeom = buildTextElementSvgMarkup(
      craft({ position: { x: 0, y: 0, width: PAYLOAD, height: 50 } }), 'hi', ctxOf());
    expect(outGeom).not.toContain('<img');
    expect(outGeom).toContain('&lt;img');
  });

  it('leaves legitimate values byte-for-byte (WYSIWYG)', () => {
    const out = buildTextElementSvgMarkup(craft({}), 'hi',
      ctxOf({ fontFamily: "'Shantell Sans', sans-serif", color: '#0af' }));
    expect(out).toContain("font-family:'Shantell Sans', sans-serif"); // single-quotes untouched
    expect(out).toContain('color:#0af');
    expect(out).not.toContain('&#39;'); // single-quotes NOT escaped
  });
});
