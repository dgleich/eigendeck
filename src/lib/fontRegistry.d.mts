// Ambient types for fontRegistry.mjs so TS app consumers keep full typing.

export type FontRole = 'title' | 'body' | 'hype';

export type FontFiles =
  | {
      kind: 'static';
      ext: 'ttf' | 'otf';
      regular: string;
      bold?: string;
      italic?: string;
      boldItalic?: string;
      narrowRegular?: string;
      narrowBold?: string;
    }
  | {
      kind: 'variable';
      upright: string;
      italic?: string;
      weightRange: [number, number];
    };

export interface FontPackage {
  id: string;
  label: string;
  family: string;
  narrowFamily?: string;
  mathjaxBundle: string;
  files: FontFiles;
  license: string;
  source?: string;
  description?: string;
}

/** Separate registry for code-cell-only fonts. Distinct from
 *  FONT_PACKAGES because mono fonts in eigendeck are a different
 *  concept from text fonts: no math-bundle pairing, no
 *  narrow/title/hype roles, and the picker that shows them is its
 *  own UI surface. A font CAN appear in both registries (e.g.
 *  Source Code Pro currently does, since it ships with a Latin
 *  Modern math bundle and remains usable as a body font), but the
 *  two lists are maintained independently. */
export interface MonoFontPackage {
  id: string;
  label: string;
  family: string;
  files: FontFiles;
  license?: string;
  source?: string;
  description?: string;
}

export const MONO_FONT_PACKAGES: MonoFontPackage[];
export const MONO_FONT_PACKAGE_MAP: Record<string, MonoFontPackage>;
export function resolveMonoFontPackage(id: string | undefined): MonoFontPackage;

export const FONT_PACKAGES: FontPackage[];
export const FONT_PACKAGE_MAP: Record<string, FontPackage>;
export const DEFAULT_FONT_ID: string;

export function resolveFontPackage(id: string | undefined): FontPackage;
export function resolveAnyFontPackage(id: string | undefined): FontPackage | MonoFontPackage;
export function fontForPreset(
  preset: string,
  slide: { titleFont?: string; bodyFont?: string; hypeFont?: string } | null | undefined,
  presentationDefaults: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string } | null | undefined
): FontPackage;
export function fontFamilyForPreset(pkg: FontPackage, preset: string): string;
export function bareFamilyName(pkg: FontPackage | MonoFontPackage): string;
export function bareNarrowFamilyName(pkg: FontPackage | MonoFontPackage): string | null;
export function fontFaceCSSForPackage(pkg: FontPackage): string;
export function allFontFacesCSS(): string;
export function collectUsedFontIds(presentation: {
  config?: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string; defaultMonoFont?: string };
  slides?: Array<{ titleFont?: string; bodyFont?: string; hypeFont?: string }>;
}): string[];
export function fontFilesForPackage(pkg: FontPackage | MonoFontPackage): Array<{
  filename: string;
  cssAttrs: { weight: string; style: string; isNarrow?: boolean };
}>;
export function mathCacheKey(tex: string, bundle: string, display: boolean, preamble: string): string;
