import type { NamedSize } from './textSizes.mjs';

export interface TextPresetStyle {
  label: string;
  sizeName: NamedSize;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  /** Default vertical alignment. Required on every preset (only `title` is
   *  'bottom'; the rest are 'top'). An element's `verticalAlign` still overrides. */
  valign: 'top' | 'middle' | 'bottom';
}

export const TEXT_PRESET_STYLES: Record<string, TextPresetStyle>;
