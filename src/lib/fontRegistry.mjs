// Font registry + cascade — the single source of truth shared by the TS app
// (via fonts.ts re-export) and the plain-Node HTML exporter
// (tools/export-eigendeck.mjs). Pure data + pure functions only: no DOM, no
// fetch. DOM-coupled helpers (injectFontFaces, buildEmbeddedFontFacesCSS)
// stay in fonts.ts.
//
// Types live in fontRegistry.d.mts so app consumers keep full typing.

/** @type {import('./fontRegistry.mjs').FontPackage[]} */
export const FONT_PACKAGES = [
  {
    id: 'ptsans',
    label: 'PT Sans',
    family: "'PT Sans', sans-serif",
    narrowFamily: "'PT Sans Narrow', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-ptsans-nosre.js',
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
    id: 'lato',
    label: 'Lato',
    family: "'Lato', sans-serif",
    mathjaxBundle: 'tex-mml-svg-mathjax-lato-nosre.js',
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf', bold: 'bold.ttf',
      italic: 'italic.ttf', boldItalic: 'bold-italic.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/Lato',
    description: 'Humanist sans (Łukasz Dziedzic) + matching math',
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
    },
    license: 'OFL-1.1',
    source: 'https://github.com/alerque/libertinus',
    description: 'Sans companion to Libertinus + Libertinus Math',
  },
  {
    id: 'lm-sans',
    label: 'Computer Modern Sans',
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
    label: 'Source Sans 3',
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
    label: 'Source Code Pro',
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
    label: 'Computer Modern Concrete',
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
export const FONT_PACKAGE_MAP = Object.fromEntries(
  FONT_PACKAGES.map((p) => [p.id, p])
);

export const DEFAULT_FONT_ID = 'ptsans';

/**
 * Separate registry for code-cell-only fonts. The Default Mono Font
 * picker (Inspector + Settings) reads from this list, NOT from a
 * filter applied to FONT_PACKAGES. Reason: mono fonts are their own
 * concept in eigendeck — they pair with code cells, don't take title/
 * body/hype roles, and don't ship math bundles. Keeping them as a
 * separate list lets us add coding-focused fonts (JetBrains Mono,
 * Fira Code, CMU Typewriter, etc.) without polluting the text font
 * picker.
 *
 * A font CAN appear in both registries — Source Code Pro currently
 * does, since it also ships a Latin Modern math bundle in
 * FONT_PACKAGES and remains valid as a body font. That dual listing
 * is a convenience, not a requirement.
 */
/** @type {import('./fontRegistry.mjs').MonoFontPackage[]} */
export const MONO_FONT_PACKAGES = [
  {
    id: 'source-code',
    label: 'Source Code Pro',
    family: "'Source Code Pro', monospace",
    files: {
      kind: 'variable',
      upright: 'variable.ttf', italic: 'variable-italic.ttf',
      weightRange: [200, 900],
    },
    license: 'OFL-1.1',
    source: 'https://github.com/adobe-fonts/source-code-pro',
    description: 'Adobe Source Code Pro — clean, balanced coding face',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: "'JetBrains Mono', monospace",
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf', bold: 'bold.ttf',
      italic: 'italic.ttf', boldItalic: 'bold-italic.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://github.com/JetBrains/JetBrainsMono',
    description: 'JetBrains coding font — popular modern default',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    family: "'Fira Code', monospace",
    files: {
      kind: 'variable',
      upright: 'variable.ttf',
      weightRange: [300, 700],
    },
    license: 'OFL-1.1',
    source: 'https://github.com/tonsky/FiraCode',
    description: "Mozilla's Fira — known for programming ligatures",
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    family: "'IBM Plex Mono', monospace",
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf', bold: 'bold.ttf',
      italic: 'italic.ttf', boldItalic: 'bold-italic.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://github.com/IBM/plex',
    description: 'IBM Plex Mono — humanist, pairs with PT Sans',
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    family: "'Inconsolata', monospace",
    files: {
      kind: 'variable',
      upright: 'variable.ttf',
      weightRange: [200, 900],
    },
    license: 'OFL-1.1',
    source: 'https://github.com/googlefonts/inconsolata',
    description: 'Classic narrow coding font, popular in academia',
  },
  {
    id: 'pt-mono',
    label: 'PT Mono',
    family: "'PT Mono', monospace",
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://fonts.google.com/specimen/PT+Mono',
    description: 'ParaType — pairs naturally with PT Sans body font',
  },
  {
    id: 'cmu-typewriter',
    label: 'Computer Modern Typewriter',
    family: "'CMU Typewriter Text', monospace",
    files: {
      kind: 'static', ext: 'ttf',
      regular: 'regular.ttf', bold: 'bold.ttf',
      italic: 'italic.ttf', boldItalic: 'bold-italic.ttf',
    },
    license: 'OFL-1.1',
    source: 'https://sourceforge.net/projects/cm-unicode/',
    description: 'Computer Modern Typewriter — the LaTeX classic; pairs with concrete-euler',
  },
  // Iosevka considered but excluded — TTF bundle is ~43 MB across
  // four variants, vastly larger than the rest of eigendeck's font
  // collection combined. Revisit if a subset / smaller stylistic
  // variant becomes practical.
];

export const MONO_FONT_PACKAGE_MAP = Object.fromEntries(
  MONO_FONT_PACKAGES.map((p) => [p.id, p])
);

const DEFAULT_MONO_ID = 'source-code';

/** Look up a mono font by id with fallback to source-code. */
export function resolveMonoFontPackage(id) {
  return MONO_FONT_PACKAGE_MAP[id] || MONO_FONT_PACKAGE_MAP[DEFAULT_MONO_ID];
}

/** Resolve a font id to a FontPackage, falling back to default. */
export function resolveFontPackage(id) {
  if (id && FONT_PACKAGE_MAP[id]) return FONT_PACKAGE_MAP[id];
  return FONT_PACKAGE_MAP[DEFAULT_FONT_ID];
}

/**
 * Resolve which font package applies to a given preset on a slide.
 * Priority: slide override > presentation default > 'ptsans'.
 *   - 'title' preset uses the title font
 *   - 'hype' preset uses the hype font
 *   - everything else uses the body font
 */
export function fontForPreset(preset, slide, presentationDefaults) {
  const role = preset === 'title' ? 'title'
    : preset === 'hype' ? 'hype'
    : 'body';
  const slideKey = role === 'title' ? 'titleFont' : role === 'hype' ? 'hypeFont' : 'bodyFont';
  const presKey = role === 'title' ? 'defaultTitleFont' : role === 'hype' ? 'defaultHypeFont' : 'defaultBodyFont';
  // Hype (sticky note) defaults to Shantell Sans when nothing overrides it.
  const fallback = role === 'hype' ? 'shantell' : undefined;
  return resolveFontPackage((slide && slide[slideKey]) ?? (presentationDefaults && presentationDefaults[presKey]) ?? fallback);
}

/** Build a CSS font-family string for a preset, honoring the narrow variant for footnote. */
export function fontFamilyForPreset(pkg, preset) {
  if (preset === 'footnote' && pkg.narrowFamily) return pkg.narrowFamily;
  return pkg.family;
}

/** Strip quotes/sans-serif suffix from a family string (e.g. "'PT Sans', sans-serif" → "PT Sans"). */
function bareFamily(family) {
  return family.replace(/^['"]?([^'",]+)['"]?.*$/, '$1');
}

/** Bare family name for a package (e.g. "PT Sans"), used for @font-face declarations. */
export function bareFamilyName(pkg) {
  return bareFamily(pkg.family);
}

/** Bare narrow family name, or null. */
export function bareNarrowFamilyName(pkg) {
  if (!pkg.narrowFamily) return null;
  return bareFamily(pkg.narrowFamily);
}

/**
 * Generate @font-face declarations for a single package.
 * URLs reference /fonts/<id>/<filename>.
 */
export function fontFaceCSSForPackage(pkg) {
  const name = bareFamily(pkg.family);
  const dir = `/fonts/${pkg.id}`;
  const lines = [];

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
    const decl = (file, weight, style) =>
      `@font-face { font-family: '${name}'; src: url('${dir}/${file}') ${fmt}; ` +
      `font-weight: ${weight}; font-style: ${style}; font-display: swap; }`;

    lines.push(decl(f.regular, 400, 'normal'));
    if (f.bold) lines.push(decl(f.bold, 700, 'normal'));
    if (f.italic) lines.push(decl(f.italic, 400, 'italic'));
    if (f.boldItalic) lines.push(decl(f.boldItalic, 700, 'italic'));

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

/** Generate the full @font-face block for all packages — text font
 *  registry AND the separate mono font registry. A font that appears
 *  in BOTH (e.g. Source Code Pro) emits its declarations twice; the
 *  browser dedupes identical @font-face entries so this is harmless. */
export function allFontFacesCSS() {
  return [...FONT_PACKAGES, ...MONO_FONT_PACKAGES]
    .map(fontFaceCSSForPackage)
    .join('\n');
}

/**
 * List all font package ids actually used in a presentation
 * (presentation defaults + per-slide overrides + 'ptsans' fallback).
 */
export function collectUsedFontIds(presentation) {
  const ids = new Set(['ptsans']);
  const cfg = presentation.config || {};
  if (cfg.defaultTitleFont) ids.add(cfg.defaultTitleFont);
  if (cfg.defaultBodyFont) ids.add(cfg.defaultBodyFont);
  if (cfg.defaultHypeFont) ids.add(cfg.defaultHypeFont);
  for (const s of presentation.slides || []) {
    if (s.titleFont) ids.add(s.titleFont);
    if (s.bodyFont) ids.add(s.bodyFont);
    if (s.hypeFont) ids.add(s.hypeFont);
  }
  return [...ids].filter((id) => FONT_PACKAGE_MAP[id]);
}

/**
 * For a package, list the font file paths (relative to /fonts/<id>/) plus the
 * @font-face attrs each needs.
 */
export function fontFilesForPackage(pkg) {
  const out = [];
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

/**
 * Stable cache key for (tex, bundle, display, preamble) — FNV-1a. Must stay
 * byte-identical to mathCacheKey() in src/lib/mathjaxRenderer.ts so the CLI
 * can look up SVGs the editor's iframe pool already produced.
 */
export function mathCacheKey(tex, bundle, display, preamble) {
  let h = 0x811c9dc5;
  const s = `${bundle}\x1f${display ? 'd' : 'i'}\x1f${preamble}\x1f${tex}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
