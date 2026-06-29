// The slide background colour per built-in theme. Single source of truth shared
// by the TS theme system (themes.ts → BUILT_IN_THEMES) and the static export
// (exportCore.mjs), which previously each kept their own copy of these values.
export const THEME_BACKGROUNDS = {
  white: '#ffffff',
  light: '#f5f0e8',
  dark: '#1a1a2e',
  black: '#000000',
};
