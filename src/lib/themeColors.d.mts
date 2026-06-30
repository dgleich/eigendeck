export interface ThemeColorSet {
  background: string;
  text: string;
  heading: string;
  accent: string;
  muted: string;
}

export const THEME_COLORS: Record<string, ThemeColorSet>;
export const PRESET_COLOR_MAP: Record<string, keyof ThemeColorSet>;

export function themeColorsByName(presentationTheme: string, slideTheme?: string): ThemeColorSet;
export function themeColorForPreset(theme: ThemeColorSet, preset: string): string;
