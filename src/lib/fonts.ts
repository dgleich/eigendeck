// Font packages = paired text font + MathJax math bundle.
// Each package ships TTF/OTF text font files and a MathJax SVG bundle.

export type FontRole = 'title' | 'body' | 'hype';

export interface FontPackage {
  /** Stable identifier used in presentation/slide JSON (e.g. 'shantell') */
  id: string;
  /** Human-readable name shown in UI */
  label: string;
  /** CSS font-family string for slide text (e.g. "'Shantell Sans', sans-serif") */
  family: string;
  /** Optional narrow variant family for the footnote preset */
  narrowFamily?: string;
  /** Filename of the MathJax bundle in public/mathjax/ */
  mathjaxBundle: string;
  /** Available weights (used for @font-face generation) */
  weights: number[];
  /** Available styles per weight */
  styles: ('normal' | 'italic')[];
  /** License identifier (SPDX) */
  license: string;
  /** Source URL or attribution */
  source?: string;
  /** Short description shown in dropdown subtitle */
  description?: string;
  /** Variable font axes (if applicable). Used to pick a static instance. */
  variable?: { wght?: [number, number]; wdth?: [number, number] };
}

export const FONT_PACKAGES: FontPackage[] = [
  {
    id: 'ptsans',
    label: 'PT Sans',
    family: "'PT Sans', sans-serif",
    narrowFamily: "'PT Sans Narrow', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-ptsans.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/PT+Sans',
    description: 'Patched PT Sans (serifed I) + Latin Modern Math',
  },
  {
    id: 'libertinus',
    label: 'Libertinus Serif',
    family: "'Libertinus Serif', serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-libertinus-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://github.com/alerque/libertinus',
    description: 'Classical serif with matching Libertinus Math',
  },
  {
    id: 'libertinus-sans',
    label: 'Libertinus Sans',
    family: "'Libertinus Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-libertinus-sans-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://github.com/alerque/libertinus',
    description: 'Sans companion to Libertinus + Libertinus Math',
  },
  {
    id: 'lm-sans',
    label: 'CMU Sans',
    family: "'CMU Sans Serif', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-lm-sans-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://sourceforge.net/projects/cm-unicode/',
    description: 'CMU Sans Serif + NewCM Sans Math',
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    family: "'Noto Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-noto-sans-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/noto',
    description: "Google's universal sans + Noto Sans Math",
    variable: { wght: [100, 900], wdth: [62.5, 100] },
  },
  {
    id: 'source-sans',
    label: 'Source Sans',
    family: "'Source Sans 3', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-source-sans-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://github.com/adobe-fonts/source-sans',
    description: "Adobe's Source Sans 3 + Latin Modern Math",
    variable: { wght: [200, 900] },
  },
  {
    id: 'source-code',
    label: 'Source Code',
    family: "'Source Code Pro', monospace",
    mathjaxBundle: 'tex-mml-svg-mathjax-source-code-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://github.com/adobe-fonts/source-code-pro',
    description: 'Monospace + Latin Modern Math',
    variable: { wght: [200, 900] },
  },
  {
    id: 'shantell',
    label: 'Shantell Sans',
    family: "'Shantell Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-shantell-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/Shantell+Sans',
    description: 'Hand-drawn casual + Shantell math (looks amazing!)',
    variable: { wght: [300, 800] },
  },
  {
    id: 'concrete-euler',
    label: 'CMU Concrete + Euler',
    family: "'CMU Concrete', serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-concrete-euler-nosre.js',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    license: 'OFL-1.1',
    source: 'CMU Unicode + Euler Math (CTAN)',
    description: 'Concrete Mathematics style (Knuth/Graham/Patashnik)',
  },
];

/** Map for O(1) lookup */
export const FONT_PACKAGE_MAP: Record<string, FontPackage> = Object.fromEntries(
  FONT_PACKAGES.map((p) => [p.id, p])
);

export const DEFAULT_FONT_ID = 'ptsans';

/** Resolve a font id to a FontPackage, falling back to default. */
export function resolveFontPackage(id: string | undefined): FontPackage {
  if (id && FONT_PACKAGE_MAP[id]) return FONT_PACKAGE_MAP[id];
  return FONT_PACKAGE_MAP[DEFAULT_FONT_ID];
}

/**
 * Resolve which font package applies to a given preset on a slide.
 *
 * Priority: slide override > presentation default > 'ptsans'.
 *
 * Preset → role mapping:
 *   - 'title' preset uses the title font
 *   - 'hype' preset uses the hype font
 *   - everything else uses the body font
 */
export function fontForPreset(
  preset: string,
  slide: { titleFont?: string; bodyFont?: string; hypeFont?: string },
  presentationDefaults: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string }
): FontPackage {
  const role: FontRole = preset === 'title' ? 'title'
    : preset === 'hype' ? 'hype'
    : 'body';

  const slideKey = role === 'title' ? 'titleFont' : role === 'hype' ? 'hypeFont' : 'bodyFont';
  const presKey = role === 'title' ? 'defaultTitleFont' : role === 'hype' ? 'defaultHypeFont' : 'defaultBodyFont';

  return resolveFontPackage(slide[slideKey] ?? presentationDefaults[presKey]);
}

/** Build a CSS font-family string for a preset, honoring the narrow variant for footnote. */
export function fontFamilyForPreset(pkg: FontPackage, preset: string): string {
  if (preset === 'footnote' && pkg.narrowFamily) return pkg.narrowFamily;
  return pkg.family;
}
