import type { NamedSize } from './textSizes.mjs';

export interface TextPresetStyle {
  label: string;
  sizeName: NamedSize;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
}

export const TEXT_PRESET_STYLES: Record<string, TextPresetStyle>;
