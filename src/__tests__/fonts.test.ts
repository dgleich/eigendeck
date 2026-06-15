import { describe, it, expect } from 'vitest';
import {
  FONT_PACKAGES,
  FONT_PACKAGE_MAP,
  resolveFontPackage,
  fontForPreset,
  fontFamilyForPreset,
  fontFaceCSSForPackage,
  allFontFacesCSS,
  collectUsedFontIds,
  DEFAULT_FONT_ID,
} from '../lib/fonts';

describe('FONT_PACKAGES', () => {
  it('has unique ids', () => {
    const ids = FONT_PACKAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all reference a mathjax bundle filename', () => {
    for (const p of FONT_PACKAGES) {
      expect(p.mathjaxBundle).toMatch(/^tex-mml-svg-mathjax-.+\.js$/);
    }
  });

  it('default font exists in registry', () => {
    expect(FONT_PACKAGE_MAP[DEFAULT_FONT_ID]).toBeDefined();
  });
});

describe('resolveFontPackage', () => {
  it('returns the matching package by id', () => {
    expect(resolveFontPackage('shantell').id).toBe('shantell');
  });

  it('falls back to default for unknown id', () => {
    expect(resolveFontPackage('nonexistent').id).toBe(DEFAULT_FONT_ID);
  });

  it('falls back to default for undefined', () => {
    expect(resolveFontPackage(undefined).id).toBe(DEFAULT_FONT_ID);
  });
});

describe('fontForPreset resolution priority', () => {
  it('title preset uses titleFont (slide override)', () => {
    const f = fontForPreset('title', { titleFont: 'shantell' }, {});
    expect(f.id).toBe('shantell');
  });

  it('title preset falls back to defaultTitleFont', () => {
    const f = fontForPreset('title', {}, { defaultTitleFont: 'libertinus' });
    expect(f.id).toBe('libertinus');
  });

  it('title preset falls back to ptsans when nothing set', () => {
    const f = fontForPreset('title', {}, {});
    expect(f.id).toBe('ptsans');
  });

  it('body preset uses bodyFont when set', () => {
    const f = fontForPreset('body', { bodyFont: 'noto-sans' }, {});
    expect(f.id).toBe('noto-sans');
  });

  it('hype preset uses hypeFont when set', () => {
    const f = fontForPreset('hype', { hypeFont: 'shantell' }, {});
    expect(f.id).toBe('shantell');
  });

  it('body and title can use different fonts', () => {
    const slide = { titleFont: 'shantell', bodyFont: 'libertinus' };
    expect(fontForPreset('title', slide, {}).id).toBe('shantell');
    expect(fontForPreset('body', slide, {}).id).toBe('libertinus');
  });

  it('non-title/hype presets use body font (subtitle, footnote, etc.)', () => {
    const slide = { titleFont: 'shantell', bodyFont: 'libertinus', hypeFont: 'concrete-euler' };
    for (const preset of ['body', 'textbox', 'annotation', 'footnote']) {
      expect(fontForPreset(preset, slide, {}).id).toBe('libertinus');
    }
  });

  it('slide override beats presentation default', () => {
    const f = fontForPreset(
      'body',
      { bodyFont: 'shantell' },
      { defaultBodyFont: 'libertinus' }
    );
    expect(f.id).toBe('shantell');
  });
});

describe('fontFamilyForPreset', () => {
  it('uses narrowFamily for footnote when available', () => {
    const ptsans = FONT_PACKAGE_MAP['ptsans'];
    expect(fontFamilyForPreset(ptsans, 'footnote')).toBe(ptsans.narrowFamily);
  });

  it('uses family for footnote when no narrow variant', () => {
    const shantell = FONT_PACKAGE_MAP['shantell'];
    expect(fontFamilyForPreset(shantell, 'footnote')).toBe(shantell.family);
  });

  it('uses family for non-footnote presets', () => {
    const ptsans = FONT_PACKAGE_MAP['ptsans'];
    expect(fontFamilyForPreset(ptsans, 'title')).toBe(ptsans.family);
    expect(fontFamilyForPreset(ptsans, 'body')).toBe(ptsans.family);
  });
});

describe('backward compatibility', () => {
  it('resolves to ptsans for legacy presentations with no font fields', () => {
    // Legacy slide: no titleFont/bodyFont/hypeFont
    const legacySlide = { id: 'x', elements: [], notes: '' };
    const legacyConfig = { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 };
    expect(fontForPreset('title', legacySlide, legacyConfig).id).toBe('ptsans');
    expect(fontForPreset('body', legacySlide, legacyConfig).id).toBe('ptsans');
    // hype (sticky note) defaults to Shantell when no font is set
    expect(fontForPreset('hype', legacySlide, legacyConfig).id).toBe('shantell');
    expect(fontForPreset('footnote', legacySlide, legacyConfig).id).toBe('ptsans');
  });

  it('handles missing slide fields gracefully', () => {
    expect(fontForPreset('title', {}, {}).id).toBe('ptsans');
  });

  it('handles unknown font ids by falling back to ptsans', () => {
    const slide = { titleFont: 'nonexistent-font' };
    expect(fontForPreset('title', slide, {}).id).toBe('ptsans');
  });
});

describe('collectUsedFontIds', () => {
  it('always includes ptsans even if not explicitly set', () => {
    const ids = collectUsedFontIds({ slides: [] });
    expect(ids).toContain('ptsans');
  });

  it('includes presentation defaults', () => {
    const ids = collectUsedFontIds({
      config: { defaultTitleFont: 'shantell', defaultBodyFont: 'libertinus' },
      slides: [],
    });
    expect(ids).toContain('shantell');
    expect(ids).toContain('libertinus');
  });

  it('includes all per-slide overrides', () => {
    const ids = collectUsedFontIds({
      slides: [
        { titleFont: 'noto-sans' },
        { bodyFont: 'source-sans' },
        { hypeFont: 'concrete-euler' },
      ],
    });
    expect(ids).toContain('noto-sans');
    expect(ids).toContain('source-sans');
    expect(ids).toContain('concrete-euler');
  });

  it('deduplicates ids', () => {
    const ids = collectUsedFontIds({
      config: { defaultTitleFont: 'shantell', defaultBodyFont: 'shantell' },
      slides: [{ titleFont: 'shantell' }],
    });
    expect(ids.filter((i) => i === 'shantell').length).toBe(1);
  });

  it('filters out unknown font ids', () => {
    const ids = collectUsedFontIds({
      slides: [{ titleFont: 'definitely-not-a-real-font' }],
    });
    expect(ids).not.toContain('definitely-not-a-real-font');
    expect(ids).toContain('ptsans');
  });
});

describe('@font-face CSS generation', () => {
  it('generates 4 declarations for static fonts with regular/bold/italic/bold-italic', () => {
    const css = fontFaceCSSForPackage(FONT_PACKAGE_MAP['libertinus']);
    expect((css.match(/@font-face/g) || []).length).toBe(4);
    expect(css).toContain("font-family: 'Libertinus Serif'");
    expect(css).toContain("/fonts/libertinus/regular.otf");
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-weight: 700");
    expect(css).toContain("font-style: italic");
    expect(css).toContain("format('opentype')");
  });

  it('generates 2 declarations for variable fonts with upright + italic', () => {
    const css = fontFaceCSSForPackage(FONT_PACKAGE_MAP['shantell']);
    expect((css.match(/@font-face/g) || []).length).toBe(2);
    expect(css).toContain("font-weight: 300 800");
    expect(css).toContain("font-style: normal");
    expect(css).toContain("font-style: italic");
    expect(css).toContain("/fonts/shantell/variable.ttf");
    expect(css).toContain("/fonts/shantell/variable-italic.ttf");
  });

  it('emits separate @font-face for narrow variant on ptsans', () => {
    const css = fontFaceCSSForPackage(FONT_PACKAGE_MAP['ptsans']);
    expect(css).toContain("font-family: 'PT Sans'");
    expect(css).toContain("font-family: 'PT Sans Narrow'");
    expect(css).toContain("/fonts/ptsans/narrow-regular.ttf");
    expect(css).toContain("/fonts/ptsans/narrow-bold.ttf");
  });

  it('skips bold-italic for libertinus-sans (no file)', () => {
    const css = fontFaceCSSForPackage(FONT_PACKAGE_MAP['libertinus-sans']);
    expect((css.match(/@font-face/g) || []).length).toBe(3); // R, B, I — no BI
  });

  it('allFontFacesCSS includes all packages', () => {
    const css = allFontFacesCSS();
    for (const pkg of FONT_PACKAGES) {
      expect(css).toContain(`/fonts/${pkg.id}/`);
    }
  });
});
