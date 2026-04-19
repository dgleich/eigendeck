/**
 * Theme definitions for Eigendeck presentations.
 *
 * To add a custom theme, add an entry to BUILT_IN_THEMES below.
 * LLMs: this file is the single source of truth for theme colors.
 */

export interface ThemeColors {
  background: string;  // slide background
  text: string;        // body/textbox default text
  heading: string;     // title text
  accent: string;      // annotation text
  muted: string;       // footnote text
}

export const BUILT_IN_THEMES: Record<string, { label: string; colors: ThemeColors }> = {
  white: {
    label: 'White',
    colors: {
      background: '#ffffff',
      text: '#222222',
      heading: '#222222',
      accent: '#2563eb',
      muted: '#888888',
    },
  },
  light: {
    label: 'Light',
    colors: {
      background: '#f5f0e8',
      text: '#2c2418',
      heading: '#2c2418',
      accent: '#1e5c99',
      muted: '#8c7e6a',
    },
  },
  dark: {
    label: 'Dark',
    colors: {
      background: '#1a1a2e',
      text: '#e8e8e8',
      heading: '#f0f0f0',
      accent: '#60a5fa',
      muted: '#9ca3af',
    },
  },
  black: {
    label: 'Black',
    colors: {
      background: '#000000',
      text: '#ffffff',
      heading: '#ffffff',
      accent: '#93c5fd',
      muted: '#9ca3af',
    },
  },
};

/** Map preset names to theme color keys */
const PRESET_COLOR_MAP: Record<string, keyof ThemeColors> = {
  title: 'heading',
  body: 'text',
  textbox: 'text',
  annotation: 'accent',
  footnote: 'muted',
};

/** Resolve the effective theme for a slide */
export function resolveTheme(presentationTheme: string, slideTheme?: string): ThemeColors {
  const name = slideTheme || presentationTheme || 'white';
  return BUILT_IN_THEMES[name]?.colors || BUILT_IN_THEMES.white.colors;
}

/** Get the theme-default color for a text preset, or undefined if not themed */
export function themeColorForPreset(theme: ThemeColors, preset: string): string {
  const key = PRESET_COLOR_MAP[preset];
  return key ? theme[key] : theme.text;
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
