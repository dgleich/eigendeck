// Font packages = paired text font + MathJax math bundle.
//
// The registry data and pure cascade/CSS logic live in fontRegistry.mjs so the
// plain-Node HTML exporter (tools/export-eigendeck.mjs) shares ONE source of
// truth with the app. This file re-exports that surface unchanged and adds the
// two helpers that need a browser/Tauri context (fetch + document).

export type { FontRole, FontFiles, FontPackage, MonoFontPackage } from './fontRegistry.mjs';

import {
  resolveFontPackage,
  collectUsedFontIds,
  fontFilesForPackage,
  bareFamilyName,
  bareNarrowFamilyName,
  allFontFacesCSS,
} from './fontRegistry.mjs';

export {
  FONT_PACKAGES,
  FONT_PACKAGE_MAP,
  MONO_FONT_PACKAGES,
  MONO_FONT_PACKAGE_MAP,
  DEFAULT_FONT_ID,
  resolveFontPackage,
  resolveMonoFontPackage,
  fontForPreset,
  fontFamilyForPreset,
  fontFaceCSSForPackage,
  allFontFacesCSS,
  collectUsedFontIds,
  fontFilesForPackage,
  bareFamilyName,
  bareNarrowFamilyName,
} from './fontRegistry.mjs';

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
 * Embedded @font-face CSS (base64 data: URLs) for a SINGLE font package, to
 * inline into a self-contained SVG (e.g. a pasted Sheets table) so it renders
 * in the deck font regardless of system fonts. An <img>-rendered SVG can't use
 * the page's @font-face fonts — only system fonts or fonts embedded in the SVG
 * itself — so this is how a table gets the deck font reliably (editor,
 * thumbnail, PDF). Only the needed faces are fetched to keep the SVG small;
 * the narrow face is always skipped.
 *
 * Returns the CSS plus the bare family name to reference in font-family.
 */
export async function embeddedFontFaceCSSForId(
  id: string | undefined,
  need: { bold?: boolean; italic?: boolean } = {},
): Promise<{ css: string; family: string }> {
  const pkg = resolveFontPackage(id);
  const family = bareFamilyName(pkg);
  const lines: string[] = [];
  for (const { filename, cssAttrs } of fontFilesForPackage(pkg)) {
    if (cssAttrs.isNarrow) continue;
    const faceBold = String(cssAttrs.weight) === '700';
    const faceItalic = cssAttrs.style === 'italic';
    // Keep the upright/regular (incl. variable, which covers bold via its
    // weight axis); drop bold/italic-only faces unless the table uses them.
    if (faceBold && !need.bold) continue;
    if (faceItalic && !need.italic) continue;
    try {
      const resp = await fetch(`/fonts/${pkg.id}/${filename}`);
      if (!resp.ok) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 8192) binary += String.fromCharCode(...buf.slice(i, i + 8192));
      const ext = filename.split('.').pop() || 'ttf';
      const mime = ext === 'otf' ? 'font/otf' : 'font/ttf';
      const fmt = ext === 'otf' ? "format('opentype')" : "format('truetype')";
      const dataUrl = `data:${mime};base64,${btoa(binary)}`;
      lines.push(
        `@font-face { font-family: '${family}'; src: url('${dataUrl}') ${fmt}; ` +
        `font-weight: ${cssAttrs.weight}; font-style: ${cssAttrs.style}; font-display: swap; }`,
      );
    } catch (e) {
      console.warn(`Failed to embed font ${pkg.id}/${filename}:`, e);
    }
  }
  return { css: lines.join('\n'), family };
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
