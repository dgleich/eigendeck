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

export const FONT_PACKAGES: FontPackage[];
export const FONT_PACKAGE_MAP: Record<string, FontPackage>;
export const DEFAULT_FONT_ID: string;

export function resolveFontPackage(id: string | undefined): FontPackage;
export function fontForPreset(
  preset: string,
  slide: { titleFont?: string; bodyFont?: string; hypeFont?: string } | null | undefined,
  presentationDefaults: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string } | null | undefined
): FontPackage;
export function fontFamilyForPreset(pkg: FontPackage, preset: string): string;
export function bareFamilyName(pkg: FontPackage): string;
export function bareNarrowFamilyName(pkg: FontPackage): string | null;
export function fontFaceCSSForPackage(pkg: FontPackage): string;
export function allFontFacesCSS(): string;
export function collectUsedFontIds(presentation: {
  config?: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string };
  slides?: Array<{ titleFont?: string; bodyFont?: string; hypeFont?: string }>;
}): string[];
export function fontFilesForPackage(pkg: FontPackage): Array<{
  filename: string;
  cssAttrs: { weight: string; style: string; isNarrow?: boolean };
}>;
export function mathCacheKey(tex: string, bundle: string, display: boolean, preamble: string): string;
