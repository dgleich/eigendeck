import { describe, it, expect } from 'vitest';
import { THEME_BACKGROUNDS } from './themeBackgrounds.mjs';

// @simplify-guard — pins the shared theme-background values that were previously
// duplicated in themes.ts and exportCore.mjs. Safe to prune once trusted.
describe('[simplify-guard] THEME_BACKGROUNDS', () => {
  it('has the expected per-theme slide backgrounds', () => {
    expect(THEME_BACKGROUNDS).toEqual({
      white: '#ffffff',
      light: '#f5f0e8',
      dark: '#1a1a2e',
      black: '#000000',
    });
  });
});
