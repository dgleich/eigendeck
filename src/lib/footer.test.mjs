import { describe, it, expect } from 'vitest';
import { footerFontFamily, showFooter, FOOTER_DEFAULT_FONT_ID } from './footer.mjs';

describe('footer helpers (#135)', () => {
  it('footerFontFamily defaults to Lato (the deck default) when unset', () => {
    expect(FOOTER_DEFAULT_FONT_ID).toBe('lato');
    expect(footerFontFamily(undefined)).toContain('Lato');
    expect(footerFontFamily({})).toContain('Lato');
    expect(footerFontFamily({ footerFont: undefined })).toContain('Lato');
  });
  it('footerFontFamily honors config.footerFont', () => {
    const custom = footerFontFamily({ footerFont: 'shantell' });
    expect(custom).toContain('Shantell');
    expect(custom).not.toContain('Lato');
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
