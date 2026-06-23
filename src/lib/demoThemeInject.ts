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
  resolveMonoFontPackage, allFontFacesCSS,
} from './fonts';
import { demoThemeVarsCss, injectDemoThemeIntoDoc } from './demoTheme.mjs';

// ---- @font-face by shared URL (NOT data URLs) --------------------------------
// The registry's @font-face block references /fonts/<id>/<file>; the MAIN
// document already loads those, so WebKit has them cached. We rewrite the
// relative path to an absolute same-origin URL so it resolves inside the demo's
// blob iframe too — then the browser fetches each font file ONCE and reuses it
// across every demo iframe AND the main doc (no per-iframe byte duplication).
// (Export embeds data: URLs instead, via fileOps' fontFacesCss opt, because an
// exported HTML file must be self-contained/offline.)
let _urlFacesCache: string | null = null;
export function demoFontFacesCss(): string {
  if (_urlFacesCache != null) return _urlFacesCache;
  const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
  // registry emits url('/fonts/...') — make it absolute so the blob iframe (whose
  // base URL is the blob, not the app) resolves it against the app origin.
  _urlFacesCache = allFontFacesCSS().split("url('/fonts/").join(`url('${origin}/fonts/`);
  return _urlFacesCache;
}

/** The :root{--eigendeck-*} block for a slide's resolved theme + fonts. */
export function demoVarsCssForSlide(config: PresentationConfig, theme: string, slide: Slide): string {
  const colors = resolveTheme(theme, slide.theme);
  const bodyPkg = fontForPreset('body', slide, config);
  const monoPkg = resolveMonoFontPackage(config?.defaultMonoFont);
  // Mono pkg carries a full CSS stack ("'Source Code Pro', monospace"); take the
  // first quoted family for the bare --eigendeck-mono name.
  const monoFamily = monoPkg?.family?.match(/'([^']+)'/)?.[1] || undefined;
  // Only PT Sans ships a real narrow variant. For every other font, fall back to
  // the body font itself (NOT a clashing 'PT Sans Narrow') so a demo using
  // var(--eigendeck-narrow) stays in the deck's typeface — same as the footnote
  // preset's cascade.
  const narrowFamily = bareNarrowFamilyName(bodyPkg) || bareFamilyName(bodyPkg);
  return demoThemeVarsCss(colors, {
    font: bareFamilyName(bodyPkg),
    narrow: narrowFamily,
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
    const fontFacesCss = demoFontFacesCss(); // sync; shared-URL @font-face

    const inject = () => {
      const ifr = iframeRef.current;
      if (!ifr || cancelled) return;
      let doc: Document | null = null;
      try { doc = ifr.contentDocument; } catch { doc = null; } // cross-origin → bail
      if (!doc || !(doc.head || doc.documentElement)) return;
      injectDemoThemeIntoDoc(doc, fontFacesCss, varsCss);
    };

    inject();
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
