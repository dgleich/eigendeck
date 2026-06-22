// In-app (editor + present) side of demo theme inheritance (#86). Computes the
// theme vars + @font-face CSS for a slide and injects them LIVE into a demo
// iframe's contentDocument — no reblob, so a running demo keeps its state across
// theme switches. Uses the same contentDocument access previewCache.ts relies on
// (same-origin blob iframe with sandbox="allow-scripts allow-same-origin").
//
// The CSS *values* come from the shared demoTheme.mjs so editor/present/export
// can't drift; only the delivery differs (live DOM here vs static srcdoc there).
//
// Takes config + theme + slide (not a full Presentation) so it works from the
// store-backed editor AND the prop-driven PresentSlide/presenter (which only
// carry the slide + config + theme via PresentCtx).

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Slide, PresentationConfig } from '../types/presentation';
import { effectiveTextPresetSize } from '../types/presentation';
import { resolveTheme } from './themes';
import {
  fontForPreset, bareFamilyName, bareNarrowFamilyName,
  resolveMonoFontPackage, buildEmbeddedFontFacesCSS,
  collectUsedFontIds,
} from './fonts';
import { demoThemeVarsCss, injectDemoThemeIntoDoc } from './demoTheme.mjs';

// ---- @font-face (data: URLs) — heavy; memoized per used-font-id set ----------
const fontFacesCache = new Map<string, Promise<string>>();

/** Data-URL @font-face CSS for the fonts a slide uses (deck defaults + the
 *  slide's per-role overrides). Cached by the set of used font ids so we
 *  fetch+base64 each font at most once. */
export function demoFontFacesCss(config: PresentationConfig, slide: Slide): Promise<string> {
  const mini = { config, slides: [slide] };
  const key = collectUsedFontIds(mini).slice().sort().join(',');
  let p = fontFacesCache.get(key);
  if (!p) {
    p = buildEmbeddedFontFacesCSS(mini).catch((e) => {
      console.warn('[demoTheme] font-face build failed:', e);
      return '';
    });
    fontFacesCache.set(key, p);
  }
  return p;
}

/** The :root{--eigendeck-*} block for a slide's resolved theme + fonts. */
export function demoVarsCssForSlide(config: PresentationConfig, theme: string, slide: Slide): string {
  const colors = resolveTheme(theme, slide.theme);
  const bodyPkg = fontForPreset('body', slide, config);
  const monoPkg = resolveMonoFontPackage(config?.defaultMonoFont);
  // Mono pkg carries a full CSS stack ("'Source Code Pro', monospace"); take the
  // first quoted family for the bare --eigendeck-mono name.
  const monoFamily = monoPkg?.family?.match(/'([^']+)'/)?.[1] || undefined;
  return demoThemeVarsCss(colors, {
    font: bareFamilyName(bodyPkg),
    narrow: bareNarrowFamilyName(bodyPkg) || undefined,
    mono: monoFamily,
    baseSize: effectiveTextPresetSize('body', config),
  });
}

/**
 * Inject (and keep updated) the demo theme styles into a demo iframe.
 * Re-injects on theme/font change and whenever the iframe (re)loads.
 */
export function useDemoThemeInjection(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  config: PresentationConfig,
  theme: string,
  slide: Slide | undefined,
  reloadKey?: unknown,
): void {
  const varsCss = slide ? demoVarsCssForSlide(config, theme, slide) : '';

  useEffect(() => {
    if (!slide) return;
    let cancelled = false;
    let fontFacesCss = '';

    const inject = () => {
      const ifr = iframeRef.current;
      if (!ifr || cancelled) return;
      let doc: Document | null = null;
      try { doc = ifr.contentDocument; } catch { doc = null; } // cross-origin → bail
      if (!doc || !(doc.head || doc.documentElement)) return;
      injectDemoThemeIntoDoc(doc, fontFacesCss, varsCss);
    };

    // Fonts resolve async; inject vars immediately, then again once fonts land.
    inject();
    void demoFontFacesCss(config, slide).then((css) => {
      if (cancelled) return;
      fontFacesCss = css;
      inject();
    });

    // The iframe may load after this effect runs (blob load is async) — inject
    // on load too, and retry a few frames in case load already fired.
    const ifr = iframeRef.current;
    ifr?.addEventListener('load', inject);
    const timers = [80, 250, 700, 1500].map((ms) => window.setTimeout(inject, ms));

    return () => {
      cancelled = true;
      ifr?.removeEventListener('load', inject);
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef, config, theme, slide, varsCss, reloadKey]);
}
