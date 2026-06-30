/** Named sizes in the deck's type scale. Five buckets covering every size the
 *  TextPresets need; other element types (notebooks, future code blocks) pick
 *  from this same vocabulary so the deck has ONE type scale.
 *  UX note: 'title' is reserved for title text elements in the inspector pickers. */
export type NamedSize = 'footnote' | 'note' | 'body' | 'title' | 'hype';

type TextSizeConfig = { textSizes?: Partial<Record<NamedSize, number>> } | null;

export const DEFAULT_TEXT_SIZES: Record<NamedSize, number>;
export const PRESET_SIZE_NAME: Record<string, NamedSize>;

export function resolveNamedSize(name: NamedSize, config?: TextSizeConfig): number;
export function effectiveTextPresetSize(preset: string, config?: TextSizeConfig): number;
export function effectiveFontSize(
  element:
    | { type: 'text'; preset: string; fontSize?: number; fontSizeName?: NamedSize }
    | { type: 'notebook'; fontSize?: number; fontSizeName?: NamedSize },
  config?: TextSizeConfig,
): number;
