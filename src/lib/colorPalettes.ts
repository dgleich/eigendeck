// The single source of the color swatch palettes, shared by every color control
// (the inline text-format toolbar + the inspector text-color / background / arrow /
// cover pickers) via <ColorControl>. Previously each site kept its own array
// (COLORS / TEXT_COLORS / ARROW_COLORS / TEXT_BG_COLORS), which drifted — the inline
// bar and inspector even disagreed on the "text color" set. Canonical now.

export interface Swatch {
  color: string;
  /** Tooltip (used by the text palette; fill/arrow swatches are self-evident). */
  label?: string;
}

/** Foreground text color — neutrals + each hue in a normal and a light shade.
 *  Canonical for BOTH the inline toolbar and the inspector text-color picker
 *  (was the toolbar's 17-entry `COLORS`; the inspector's leaner 10 was a subset). */
export const TEXT_PALETTE: readonly Swatch[] = [
  { color: '#222222', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#9ca3af', label: 'Medium Grey' },
  { color: '#d1d5db', label: 'Light Grey' },
  { color: '#16a34a', label: 'Green' },
  { color: '#86efac', label: 'Light Green' },
  { color: '#0d9488', label: 'Teal' },
  { color: '#5eead4', label: 'Light Teal' },
  { color: '#2563eb', label: 'Blue' },
  { color: '#93c5fd', label: 'Light Blue' },
  { color: '#dc2626', label: 'Red' },
  { color: '#fca5a5', label: 'Light Red' },
  { color: '#ea580c', label: 'Orange' },
  { color: '#fdba74', label: 'Light Orange' },
  { color: '#9333ea', label: 'Purple' },
  { color: '#c4b5fd', label: 'Light Purple' },
  { color: '#ffffff', label: 'White' },
];

/** Fill palette for panels/masks — text-box backgrounds AND cover rectangles.
 *  Bands: neutrals, soft tints (legible panels over busy slides), medium tints,
 *  then a few deep saturated fills. */
export const FILL_PALETTE: readonly Swatch[] = [
  { color: '#ffffff' }, { color: '#f3f4f6' }, { color: '#d1d5db' }, { color: '#9ca3af' }, { color: '#374151' }, { color: '#000000' },
  { color: '#fee2e2' }, { color: '#ffedd5' }, { color: '#fef9c3' }, { color: '#fff3b0' }, { color: '#dcfce7' }, { color: '#ccfbf1' },
  { color: '#fca5a5' }, { color: '#fdba74' }, { color: '#fde047' }, { color: '#86efac' }, { color: '#5eead4' }, { color: '#7dd3fc' },
  { color: '#93c5fd' }, { color: '#a5b4fc' }, { color: '#c4b5fd' }, { color: '#f0abfc' }, { color: '#f9a8d4' },
  { color: '#b91c1c' }, { color: '#15803d' }, { color: '#1d4ed8' }, { color: '#6d28d9' },
];

/** Arrow stroke palette — saturated colors, no light neutrals. */
export const ARROW_PALETTE: readonly Swatch[] = [
  { color: '#e53e3e' }, { color: '#dc2626' }, { color: '#ea580c' }, { color: '#16a34a' },
  { color: '#2563eb' }, { color: '#9333ea' }, { color: '#222222' }, { color: '#6b7280' },
];

/** Themed tint bases (#132): 'accent' follows the slide theme; the rest are
 *  semantic (alert red, example green, amber, purple). Each renders RELATIVE to the
 *  slide background (a wash for fills, the accent solid for foreground) so it stays
 *  colored + contrasting on ANY theme. */
export interface TintSwatch { base: string; title: string; }
export const TINT_SWATCHES: readonly TintSwatch[] = [
  { base: 'accent', title: 'Theme accent tint (adapts to each slide theme)' },
  { base: '#dc2626', title: 'Red tint (alert)' },
  { base: '#16a34a', title: 'Green tint (example)' },
  { base: '#d97706', title: 'Amber tint' },
  { base: '#7c3aed', title: 'Purple tint' },
];

/** The single accent tint — the only theme-relative option for a FOREGROUND color
 *  (text/arrow), where the semantic tints would just be literal colors. */
export const ACCENT_TINT: readonly TintSwatch[] = [
  { base: 'accent', title: 'Theme accent (adapts to each slide theme)' },
];
