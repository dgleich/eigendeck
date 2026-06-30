// The slide background colour per built-in theme — now DERIVED from the full
// theme-color map (themeColors.mjs), the single source of truth. Kept as a named
// export for existing importers; the literal background values no longer live in
// two places.
import { THEME_COLORS } from './themeColors.mjs';

export const THEME_BACKGROUNDS = Object.fromEntries(
  Object.entries(THEME_COLORS).map(([name, c]) => [name, c.background]),
);
