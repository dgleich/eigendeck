import { describe, it, expect } from 'vitest';
import { mixHex, textBackgroundResolved, textBoxShadowCss, TINT_STRENGTH, resolveColor, boxShadowExtents } from './textStyle.mjs';

describe('mixHex', () => {
  it('mixes two hex colors by t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ffffff', '#ff0000', 0)).toBe('#ffffff');
    expect(mixHex('#ffffff', '#ff0000', 1)).toBe('#ff0000');
  });
  it('falls back to a on bad input', () => {
    expect(mixHex('red', '#ffffff', 0.5)).toBe('red');
  });
});

describe('textBackgroundResolved (#132 boxTint)', () => {
  const theme = { background: '#ffffff', accent: '#2563eb' };

  it('tints toward the accent (~15%) when boxTint is "accent"', () => {
    const bg = textBackgroundResolved({ boxTint: 'accent' }, theme);
    // white 85% + accent 15% → a pale blue, not white and not the accent
    expect(bg).not.toBe('#ffffff');
    expect(bg).not.toBe('#2563eb');
    expect(bg?.startsWith('#')).toBe(true);
  });

  it('tints toward a given hex boxTint', () => {
    expect(textBackgroundResolved({ boxTint: '#ff0000' }, { background: '#ffffff' }))
      .toBe(mixHex('#ffffff', '#ff0000', TINT_STRENGTH));
  });

  it('adapts to the theme background (dark theme lifts, not greys)', () => {
    const light = textBackgroundResolved({ boxTint: 'accent' }, { background: '#ffffff', accent: '#2563eb' });
    const dark = textBackgroundResolved({ boxTint: 'accent' }, { background: '#111111', accent: '#2563eb' });
    expect(light).not.toBe(dark);
  });

  it('falls back to the fixed backgroundColor when no boxTint', () => {
    expect(textBackgroundResolved({ backgroundColor: '#abcdef' }, theme)).toBe('#abcdef');
    expect(textBackgroundResolved({}, theme)).toBeUndefined();
  });
});

describe('resolveColor (#132 accent token)', () => {
  const theme = { accent: '#2563eb' };
  it('undefined color → the per-preset fallback', () => {
    expect(resolveColor(undefined, theme, '#222222')).toBe('#222222');
  });
  it("'accent' → the theme accent (re-adapts per theme)", () => {
    expect(resolveColor('accent', { accent: '#2563eb' }, '#222')).toBe('#2563eb');
    expect(resolveColor('accent', { accent: '#60a5fa' }, '#222')).toBe('#60a5fa');
  });
  it("'accent' with no theme accent → fallback", () => {
    expect(resolveColor('accent', {}, '#222222')).toBe('#222222');
    expect(resolveColor('accent', null, '#222222')).toBe('#222222');
  });
  it('a literal color passes through untouched', () => {
    expect(resolveColor('#ff0000', theme, '#222222')).toBe('#ff0000');
  });
});

describe('boxShadowExtents (cover grows past a card shadow)', () => {
  it('is all-zero when the element has no box shadow', () => {
    expect(boxShadowExtents({})).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(boxShadowExtents({ boxShadow: true })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 }); // no fill → no shadow
  });
  it('matches the shadow (0 4px 14px) extent per side for a card', () => {
    // ox=0, oy=4, blur=14 → left/right = 14, top = 14-4 = 10, bottom = 14+4 = 18
    expect(boxShadowExtents({ boxShadow: true, boxTint: 'accent' })).toEqual({ left: 14, right: 14, top: 10, bottom: 18 });
    expect(boxShadowExtents({ boxShadow: true, backgroundColor: '#eee' })).toEqual({ left: 14, right: 14, top: 10, bottom: 18 });
  });
});

describe('textBoxShadowCss', () => {
  it('fires for a themed-tint box even without a fixed backgroundColor', () => {
    expect(textBoxShadowCss({ boxShadow: true, boxTint: 'accent' })).toBeTruthy();
    expect(textBoxShadowCss({ boxShadow: true })).toBeUndefined();
  });
});
