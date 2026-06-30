// SINGLE SOURCE OF TRUTH for built-in theme colors. Pure `.mjs` so BOTH the TS
// theme system (themes.ts → BUILT_IN_THEMES) and the static HTML export
// (exportCore.mjs, used by the headless eigendeck-cli) share one copy — neither
// keeps its own. Foreground colors live here too (not just backgrounds), which
// is what lets the CLI export resolve theme-aware text color and fixes #104
// (the CLI legacy text path previously used hard-coded preset colors, so a
// default-color text element on a dark/black theme came out near-invisible).
//
// Values mirror BUILT_IN_THEMES in themes.ts (which now consumes this map).

export const THEME_COLORS = {
  white: { background: '#ffffff', text: '#222222', heading: '#222222', accent: '#2563eb', muted: '#888888' },
  light: { background: '#f5f0e8', text: '#2c2418', heading: '#2c2418', accent: '#1e5c99', muted: '#8c7e6a' },
  dark:  { background: '#1a1a2e', text: '#e8e8e8', heading: '#f0f0f0', accent: '#60a5fa', muted: '#9ca3af' },
  black: { background: '#000000', text: '#ffffff', heading: '#ffffff', accent: '#93c5fd', muted: '#9ca3af' },
};

// Text-preset name → which theme color key it draws from.
export const PRESET_COLOR_MAP = {
  title: 'heading',
  body: 'text',
  textbox: 'text',
  annotation: 'accent',
  footnote: 'muted',
};

/** Resolve a slide's effective theme colors by name (slide theme wins over deck). */
export function themeColorsByName(presentationTheme, slideTheme) {
  const name = slideTheme || presentationTheme || 'white';
  return THEME_COLORS[name] || THEME_COLORS.white;
}

/** Theme-default color for a text preset (falls back to body text color). */
export function themeColorForPreset(theme, preset) {
  const key = PRESET_COLOR_MAP[preset];
  return key ? theme[key] : theme.text;
}
