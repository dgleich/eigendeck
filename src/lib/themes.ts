/**
 * Theme definitions for Eigendeck presentations.
 *
 * Color VALUES live in the canonical, framework-free map `themeColors.mjs`
 * (shared with the headless CLI export). This file is the TS surface over that
 * map — types, UI labels, and the resolver helpers.
 * To add a custom theme, add an entry to THEME_COLORS in themeColors.mjs.
 */

import { THEME_COLORS, themeColorsByName, themeColorForPreset as themeColorForPresetMjs } from './themeColors.mjs';

export interface ThemeColors {
  background: string;  // slide background
  text: string;        // body/textbox default text
  heading: string;     // title text
  accent: string;      // annotation text
  muted: string;       // footnote text
}

const THEME_LABELS: Record<string, string> = {
  white: 'White', light: 'Light', dark: 'Dark', black: 'Black',
};

// Colors come from the canonical map (themeColors.mjs); this layer adds UI labels.
export const BUILT_IN_THEMES: Record<string, { label: string; colors: ThemeColors }> =
  Object.fromEntries(
    Object.entries(THEME_COLORS).map(([name, colors]) => [
      name, { label: THEME_LABELS[name] || name, colors: colors as ThemeColors },
    ]),
  );

/** Resolve the effective theme for a slide */
export function resolveTheme(presentationTheme: string, slideTheme?: string): ThemeColors {
  return themeColorsByName(presentationTheme, slideTheme) as ThemeColors;
}

/** Get the theme-default color for a text preset, or undefined if not themed */
export function themeColorForPreset(theme: ThemeColors, preset: string): string {
  return themeColorForPresetMjs(theme, preset);
}

/** Check if a theme is "dark" (for UI decisions like icon colors) */
export function isDarkTheme(theme: ThemeColors): boolean {
  // Simple luminance check on background
  const hex = theme.background.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}
