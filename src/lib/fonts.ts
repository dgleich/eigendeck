// Font packages = paired text font + MathJax math bundle.
// Each package ships TTF/OTF text font files and a MathJax SVG bundle.

export type FontRole = 'title' | 'body' | 'hype';

/**
 * File layout for a font package's text font(s).
 * Files live under public/fonts/<id>/ and are referenced relative to /fonts/<id>/.
 */
export type FontFiles =
  | {
      kind: 'static';
      ext: 'ttf' | 'otf';
      regular: string;       // e.g. 'regular.otf'
      bold?: string;
      italic?: string;
      boldItalic?: string;
      narrowRegular?: string; // e.g. 'narrow-regular.ttf' (ptsans only)
      narrowBold?: string;
    }
  | {
      kind: 'variable';
      upright: string;       // e.g. 'variable.ttf'
      italic?: string;       // e.g. 'variable-italic.ttf'
      weightRange: [number, number];
    };

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
  /** Files on disk, used to generate @font-face declarations */
  files: FontFiles;
  /** License identifier (SPDX) */
  license: string;
  /** Source URL or attribution */
  source?: string;
  /** Short description shown in dropdown subtitle */
  description?: string;
}

export const FONT_PACKAGES: FontPackage[] = [
  {
    id: 'ptsans',
    label: 'PT Sans',
    family: "'PT Sans', sans-serif",
    narrowFamily: "'PT Sans Narrow', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-ptsans.js',
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf',
      bold: 'bold.ttf',
      italic: 'italic.ttf',
      narrowRegular: 'narrow-regular.ttf',
      narrowBold: 'narrow-bold.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/PT+Sans',
    description: 'Patched PT Sans (serifed I) + Latin Modern Math',
  },
  {
    id: 'libertinus',
    label: 'Libertinus Serif',
    family: "'Libertinus Serif', serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-libertinus-nosre.js',
    files: {
      kind: 'static', ext: 'otf',
      regular: 'regular.otf', bold: 'bold.otf',
      italic: 'italic.otf', boldItalic: 'bold-italic.otf',
    },
    license: 'OFL-1.1',
    source: 'https://github.com/alerque/libertinus',
    description: 'Classical serif with matching Libertinus Math',
  },
  {
    id: 'libertinus-sans',
    label: 'Libertinus Sans',
    family: "'Libertinus Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-libertinus-sans-nosre.js',
    files: {
      kind: 'static', ext: 'otf',
      regular: 'regular.otf', bold: 'bold.otf',
      italic: 'italic.otf',
      // No bold-italic in static OTF distribution
    },
    license: 'OFL-1.1',
    source: 'https://github.com/alerque/libertinus',
    description: 'Sans companion to Libertinus + Libertinus Math',
  },
  {
    id: 'lm-sans',
    label: 'CMU Sans',
    family: "'CMU Sans Serif', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-lm-sans-nosre.js',
    files: {
      kind: 'static', ext: 'otf',
      regular: 'regular.otf', bold: 'bold.otf',
      italic: 'italic.otf', boldItalic: 'bold-italic.otf',
    },
    license: 'OFL-1.1',
    source: 'https://sourceforge.net/projects/cm-unicode/',
    description: 'CMU Sans Serif + NewCM Sans Math',
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    family: "'Noto Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-noto-sans-nosre.js',
    files: {
      kind: 'variable',
      upright: 'variable.ttf', italic: 'variable-italic.ttf',
      weightRange: [100, 900],
    },
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/noto',
    description: "Google's universal sans + Noto Sans Math",
  },
  {
    id: 'source-sans',
    label: 'Source Sans',
    family: "'Source Sans 3', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-source-sans-nosre.js',
    files: {
      kind: 'variable',
      upright: 'variable.ttf', italic: 'variable-italic.ttf',
      weightRange: [200, 900],
    },
    license: 'OFL-1.1',
    source: 'https://github.com/adobe-fonts/source-sans',
    description: "Adobe's Source Sans 3 + Latin Modern Math",
  },
  {
    id: 'source-code',
    label: 'Source Code',
    family: "'Source Code Pro', monospace",
    mathjaxBundle: 'tex-mml-svg-mathjax-source-code-nosre.js',
    files: {
      kind: 'variable',
      upright: 'variable.ttf', italic: 'variable-italic.ttf',
      weightRange: [200, 900],
    },
    license: 'OFL-1.1',
    source: 'https://github.com/adobe-fonts/source-code-pro',
    description: 'Monospace + Latin Modern Math',
  },
  {
    id: 'shantell',
    label: 'Shantell Sans',
    family: "'Shantell Sans', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-shantell-nosre.js',
    files: {
      kind: 'variable',
      upright: 'variable.ttf', italic: 'variable-italic.ttf',
      weightRange: [300, 800],
    },
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/Shantell+Sans',
    description: 'Hand-drawn casual + Shantell math (looks amazing!)',
  },
  {
    id: 'concrete-euler',
    label: 'CMU Concrete + Euler',
    family: "'CMU Concrete', serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-concrete-euler-nosre.js',
    files: {
      kind: 'static', ext: 'otf',
      regular: 'regular.otf', bold: 'bold.otf',
      italic: 'italic.otf', boldItalic: 'bold-italic.otf',
    },
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

/** Strip quotes/sans-serif suffix from family for use as @font-face name. */
function bareFamily(family: string): string {
  // e.g. "'PT Sans', sans-serif" → "PT Sans"
  return family.replace(/^['"]?([^'",]+)['"]?.*$/, '$1');
}

/**
 * Generate @font-face CSS declarations for a single font package.
 * URLs reference /fonts/<id>/<filename>.
 */
export function fontFaceCSSForPackage(pkg: FontPackage): string {
  const name = bareFamily(pkg.family);
  const dir = `/fonts/${pkg.id}`;
  const lines: string[] = [];

  if (pkg.files.kind === 'variable') {
    const f = pkg.files;
    const [w0, w1] = f.weightRange;
    const fmt = "format('truetype-variations'), format('truetype')";
    lines.push(
      `@font-face { font-family: '${name}'; src: url('${dir}/${f.upright}') ${fmt}; ` +
      `font-weight: ${w0} ${w1}; font-style: normal; font-display: swap; }`
    );
    if (f.italic) {
      lines.push(
        `@font-face { font-family: '${name}'; src: url('${dir}/${f.italic}') ${fmt}; ` +
        `font-weight: ${w0} ${w1}; font-style: italic; font-display: swap; }`
      );
    }
  } else {
    const f = pkg.files;
    const fmt = f.ext === 'otf' ? "format('opentype')" : "format('truetype')";
    const decl = (file: string, weight: number, style: string) =>
      `@font-face { font-family: '${name}'; src: url('${dir}/${file}') ${fmt}; ` +
      `font-weight: ${weight}; font-style: ${style}; font-display: swap; }`;

    lines.push(decl(f.regular, 400, 'normal'));
    if (f.bold) lines.push(decl(f.bold, 700, 'normal'));
    if (f.italic) lines.push(decl(f.italic, 400, 'italic'));
    if (f.boldItalic) lines.push(decl(f.boldItalic, 700, 'italic'));

    // Narrow variant gets its own family name (so e.g. footnote can target it)
    if (pkg.narrowFamily && f.narrowRegular) {
      const narrowName = bareFamily(pkg.narrowFamily);
      lines.push(
        `@font-face { font-family: '${narrowName}'; src: url('${dir}/${f.narrowRegular}') ${fmt}; ` +
        `font-weight: 400; font-style: normal; font-display: swap; }`
      );
      if (f.narrowBold) {
        lines.push(
          `@font-face { font-family: '${narrowName}'; src: url('${dir}/${f.narrowBold}') ${fmt}; ` +
          `font-weight: 700; font-style: normal; font-display: swap; }`
        );
      }
    }
  }

  return lines.join('\n');
}

/** Generate the full @font-face block for all packages. */
export function allFontFacesCSS(): string {
  return FONT_PACKAGES.map(fontFaceCSSForPackage).join('\n');
}

/**
 * List all font package ids actually used in a presentation
 * (presentation defaults + all per-slide overrides + 'ptsans' as fallback).
 */
export function collectUsedFontIds(presentation: {
  config?: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string };
  slides?: Array<{ titleFont?: string; bodyFont?: string; hypeFont?: string }>;
}): string[] {
  const ids = new Set<string>(['ptsans']); // always include default fallback
  const cfg = presentation.config || {};
  if (cfg.defaultTitleFont) ids.add(cfg.defaultTitleFont);
  if (cfg.defaultBodyFont) ids.add(cfg.defaultBodyFont);
  if (cfg.defaultHypeFont) ids.add(cfg.defaultHypeFont);
  for (const s of presentation.slides || []) {
    if (s.titleFont) ids.add(s.titleFont);
    if (s.bodyFont) ids.add(s.bodyFont);
    if (s.hypeFont) ids.add(s.hypeFont);
  }
  // Filter to known packages
  return [...ids].filter((id) => FONT_PACKAGE_MAP[id]);
}

/**
 * For a font package, list the file paths (relative to /fonts/) that should
 * be embedded as base64 in an export. Skips files that don't exist on disk
 * (caller should resolve to actual files via the file system).
 */
export function fontFilesForPackage(pkg: FontPackage): Array<{ filename: string; cssAttrs: { weight: string; style: string; isNarrow?: boolean } }> {
  const out: Array<{ filename: string; cssAttrs: { weight: string; style: string; isNarrow?: boolean } }> = [];
  if (pkg.files.kind === 'variable') {
    const f = pkg.files;
    const [w0, w1] = f.weightRange;
    out.push({ filename: f.upright, cssAttrs: { weight: `${w0} ${w1}`, style: 'normal' } });
    if (f.italic) out.push({ filename: f.italic, cssAttrs: { weight: `${w0} ${w1}`, style: 'italic' } });
  } else {
    const f = pkg.files;
    out.push({ filename: f.regular, cssAttrs: { weight: '400', style: 'normal' } });
    if (f.bold) out.push({ filename: f.bold, cssAttrs: { weight: '700', style: 'normal' } });
    if (f.italic) out.push({ filename: f.italic, cssAttrs: { weight: '400', style: 'italic' } });
    if (f.boldItalic) out.push({ filename: f.boldItalic, cssAttrs: { weight: '700', style: 'italic' } });
    if (f.narrowRegular) out.push({ filename: f.narrowRegular, cssAttrs: { weight: '400', style: 'normal', isNarrow: true } });
    if (f.narrowBold) out.push({ filename: f.narrowBold, cssAttrs: { weight: '700', style: 'normal', isNarrow: true } });
  }
  return out;
}

/** Bare family name for a package (e.g. "PT Sans"), used for @font-face declarations. */
export function bareFamilyName(pkg: FontPackage): string {
  return pkg.family.replace(/^['"]?([^'",]+)['"]?.*$/, '$1');
}

/** Bare narrow family name, or null. */
export function bareNarrowFamilyName(pkg: FontPackage): string | null {
  if (!pkg.narrowFamily) return null;
  return pkg.narrowFamily.replace(/^['"]?([^'",]+)['"]?.*$/, '$1');
}

/**
 * Build embedded @font-face declarations as data: URLs for all fonts used
 * by a presentation. Fetches font files via fetch() (so works in browser/
 * Tauri contexts where /fonts/ is served).
 *
 * Returns the CSS string ready to drop in <style>.
 */
export async function buildEmbeddedFontFacesCSS(presentation: {
  config?: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string };
  slides?: Array<{ titleFont?: string; bodyFont?: string; hypeFont?: string }>;
}): Promise<string> {
  const usedFontIds = collectUsedFontIds(presentation);
  const lines: string[] = [];
  for (const id of usedFontIds) {
    const pkg = resolveFontPackage(id);
    const family = bareFamilyName(pkg);
    const narrowFamily = bareNarrowFamilyName(pkg);
    for (const { filename, cssAttrs } of fontFilesForPackage(pkg)) {
      try {
        const url = `/fonts/${pkg.id}/${filename}`;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const buf = new Uint8Array(await resp.arrayBuffer());
        let binary = '';
        for (let i = 0; i < buf.length; i += 8192) {
          binary += String.fromCharCode(...buf.slice(i, i + 8192));
        }
        const ext = filename.split('.').pop() || 'ttf';
        const mime = ext === 'otf' ? 'font/otf' : 'font/ttf';
        const fmt = ext === 'otf' ? "format('opentype')" : "format('truetype')";
        const dataUrl = `data:${mime};base64,${btoa(binary)}`;
        const fontFamily = cssAttrs.isNarrow && narrowFamily ? narrowFamily : family;
        lines.push(
          `@font-face { font-family: '${fontFamily}'; src: url('${dataUrl}') ${fmt}; ` +
          `font-weight: ${cssAttrs.weight}; font-style: ${cssAttrs.style}; font-display: swap; }`
        );
      } catch (e) {
        console.warn(`Failed to embed font ${pkg.id}/${filename}:`, e);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Inject @font-face declarations for all font packages into <head>.
 * Idempotent: subsequent calls replace the existing block.
 */
export function injectFontFaces(): void {
  if (typeof document === 'undefined') return;
  const STYLE_ID = 'eigendeck-font-faces';
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = allFontFacesCSS();
}
