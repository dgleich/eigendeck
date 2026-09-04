// Font packages = paired text font + MathJax math bundle.
//
// The registry data and pure cascade/CSS logic live in fontRegistry.mjs so the
// plain-Node HTML exporter (tools/export-eigendeck.mjs) shares ONE source of
// truth with the app. This file re-exports that surface unchanged and adds the
// two helpers that need a browser/Tauri context (fetch + document).

export type { FontRole, FontFiles, FontPackage, MonoFontPackage } from './fontRegistry.mjs';

import {
  resolveAnyFontPackage,
  collectUsedFontIds,
  fontFilesForPackage,
  bareFamilyName,
  bareNarrowFamilyName,
  allFontFacesCSS,
} from './fontRegistry.mjs';
import { bytesToBase64 } from './base64';

export {
  FONT_PACKAGES,
  FONT_PACKAGE_MAP,
  MONO_FONT_PACKAGES,
  MONO_FONT_PACKAGE_MAP,
  DEFAULT_FONT_ID,
  HYPE_DEFAULT_FONT_ID,
  resolveFontPackage,
  resolveMonoFontPackage,
  resolveAnyFontPackage,
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
    const pkg = resolveAnyFontPackage(id);
    const family = bareFamilyName(pkg);
    const narrowFamily = bareNarrowFamilyName(pkg);
    for (const { filename, cssAttrs } of fontFilesForPackage(pkg)) {
      try {
        // Prefer the WOFF2 sibling (Brotli, ~40% of the TTF): this CSS is inlined
        // as base64 into every demo/export document, so the smaller payload is
        // re-parsed far faster on each opaque-iframe mount (docs/perf-report.md,
        // "Demos"). Falls back to the raw TTF/OTF when no .woff2 exists (a build
        // that hasn't run tools/build_font_woff2.py).
        const base = `/fonts/${pkg.id}/${filename}`;
        const woff2Url = base.replace(/\.(?:ttf|otf)$/i, '.woff2');
        let mime = 'font/woff2';
        let fmt = "format('woff2')";
        let resp = await fetch(woff2Url);
        if (!resp.ok) {
          const ext = filename.split('.').pop() || 'ttf';
          mime = ext === 'otf' ? 'font/otf' : 'font/ttf';
          fmt = ext === 'otf' ? "format('opentype')" : "format('truetype')";
          resp = await fetch(base);
          if (!resp.ok) continue;
        }
        const buf = new Uint8Array(await resp.arrayBuffer());
        const dataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;
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
