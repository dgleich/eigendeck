import { describe, it, expect } from 'vitest';
import { themeColorsByName, themeColorForPreset, THEME_COLORS } from './themeColors.mjs';

// @simplify-guard — the canonical theme-color map + resolvers, the single source
// shared by themes.ts (app) and exportCore.mjs (CLI export). Pins the #104 fix:
// the CLI legacy text path resolves theme FOREGROUND per preset, so default-color
// text is visible on dark/black themes instead of the old hard-coded #222/#888.
describe('[simplify-guard] themeColors', () => {
  it('resolves slide theme over deck theme, falling back to white', () => {
    expect(themeColorsByName('white', 'dark')).toBe(THEME_COLORS.dark);
    expect(themeColorsByName('dark')).toBe(THEME_COLORS.dark);
    expect(themeColorsByName('bogus')).toBe(THEME_COLORS.white);
  });

  it('maps each preset to its theme color key', () => {
    const t = THEME_COLORS.dark;
    expect(themeColorForPreset(t, 'title')).toBe(t.heading);
    expect(themeColorForPreset(t, 'body')).toBe(t.text);
    expect(themeColorForPreset(t, 'textbox')).toBe(t.text);
    expect(themeColorForPreset(t, 'annotation')).toBe(t.accent);
    expect(themeColorForPreset(t, 'footnote')).toBe(t.muted);
  });

  it('#104: dark/black themes give VISIBLE default text (not #222/#888)', () => {
    // body/title on dark → light foreground, not the old hard-coded near-black.
    expect(themeColorForPreset(THEME_COLORS.dark, 'body')).toBe('#e8e8e8');
    expect(themeColorForPreset(THEME_COLORS.dark, 'title')).toBe('#f0f0f0');
    expect(themeColorForPreset(THEME_COLORS.black, 'body')).toBe('#ffffff');
    // white theme is unchanged in spirit (just full-hex form).
    expect(themeColorForPreset(THEME_COLORS.white, 'body')).toBe('#222222');
  });
});
