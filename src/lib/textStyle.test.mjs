import { describe, it, expect } from 'vitest';
import { mixHex, textBackgroundResolved, textBoxShadowCss, TINT_STRENGTH } from './textStyle.mjs';

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

describe('textBoxShadowCss', () => {
  it('fires for a themed-tint box even without a fixed backgroundColor', () => {
    expect(textBoxShadowCss({ boxShadow: true, boxTint: 'accent' })).toBeTruthy();
    expect(textBoxShadowCss({ boxShadow: true })).toBeUndefined();
  });
});
