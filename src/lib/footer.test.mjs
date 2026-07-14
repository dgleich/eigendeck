import { describe, it, expect } from 'vitest';
import { footerFontFamily, showFooter, FOOTER_DEFAULT_FONT_ID } from './footer.mjs';

describe('footer helpers (#135)', () => {
  it('footerFontFamily defaults to PT Sans (historical behavior) when unset', () => {
    expect(FOOTER_DEFAULT_FONT_ID).toBe('ptsans');
    expect(footerFontFamily(undefined)).toContain('PT Sans');
    expect(footerFontFamily({})).toContain('PT Sans');
    expect(footerFontFamily({ footerFont: undefined })).toContain('PT Sans');
  });
  it('footerFontFamily honors config.footerFont', () => {
    const custom = footerFontFamily({ footerFont: 'lato' });
    expect(custom).toContain('Lato');
    expect(custom).not.toContain('PT Sans');
  });
  it('an unknown font id falls back to a valid family, never empty', () => {
    expect(footerFontFamily({ footerFont: 'does-not-exist' })).toBeTruthy();
  });
  it('showFooter is true unless slide.omitFooter is set', () => {
    expect(showFooter(undefined)).toBe(true);
    expect(showFooter(null)).toBe(true);
    expect(showFooter({})).toBe(true);
    expect(showFooter({ omitFooter: false })).toBe(true);
    expect(showFooter({ omitFooter: true })).toBe(false);
  });
});
