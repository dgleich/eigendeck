import { describe, it, expect } from 'vitest';
import { encodeClipHtml, decodeClipHtml, CLIP_VERSION } from './clipboardModel';
import type { SlideElement } from '../types/presentation';

const el = (over: Partial<SlideElement> = {}): SlideElement => ({
  id: 'e1', type: 'text', preset: 'body', html: 'hi λ', color: '#c00',
  position: { x: 10, y: 20, width: 300, height: 100 }, ...over,
} as SlideElement);

describe('clipboardModel codec', () => {
  it('round-trips an elements clip through the html payload', () => {
    const clip = { kind: 'elements' as const, elements: [el()], fromSlideId: 's1', fromSlideIndex: 0 };
    const html = encodeClipHtml(clip, '<div>hi λ</div>');
    const back = decodeClipHtml(html);
    expect(back).toEqual({ v: CLIP_VERSION, ...clip });
  });

  it('round-trips a slide clip', () => {
    const clip = { kind: 'slide' as const, slide: { id: 's1', elements: [el()], notes: 'n' } };
    const back = decodeClipHtml(encodeClipHtml(clip, '<div>slide</div>'));
    expect(back?.kind).toBe('slide');
    expect((back?.slide as { id: string }).id).toBe('s1');
  });

  it('preserves non-ASCII content (UTF-8-safe base64)', () => {
    const clip = { kind: 'elements' as const, elements: [el({ html: 'Δ Σ 日本語 ✦' })] };
    const back = decodeClipHtml(encodeClipHtml(clip, 'x'));
    expect((back?.elements?.[0] as { html?: string }).html).toBe('Δ Σ 日本語 ✦');
  });

  it('carries the marker attribute so hasEigendeckMarker still detects it', () => {
    const html = encodeClipHtml({ kind: 'elements', elements: [el()] }, 'x');
    expect(html).toContain('data-eigendeck-copy="v1"');
    expect(html).toContain('data-eigendeck-json="');
  });

  it('decodes even when the payload is embedded in surrounding html (WebKit re-wrap)', () => {
    const inner = encodeClipHtml({ kind: 'elements', elements: [el()] }, '<b>x</b>');
    const wrapped = `<html><head><meta charset="utf-8"></head><body>${inner}</body></html>`;
    expect(decodeClipHtml(wrapped)?.kind).toBe('elements');
  });

  it('returns null for foreign html / no payload / malformed', () => {
    expect(decodeClipHtml('<div><p>Word text</p></div>')).toBeNull();
    // marker present but no json payload (an eigendeck text-run copy)
    expect(decodeClipHtml('<div data-eigendeck-copy="v1">just text</div>')).toBeNull();
    expect(decodeClipHtml('<div data-eigendeck-json="not!!base64">x</div>')).toBeNull();
    expect(decodeClipHtml('')).toBeNull();
    expect(decodeClipHtml(null)).toBeNull();
  });

  it('returns null when the decoded JSON is not a valid clip kind', () => {
    // hand-craft a base64 of a wrong-shaped object
    const bad = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, kind: 'bogus' }))));
    expect(decodeClipHtml(`<div data-eigendeck-json="${bad}">x</div>`)).toBeNull();
  });
});
