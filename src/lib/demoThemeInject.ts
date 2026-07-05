// Computes the theme vars (--eigendeck-*) for a slide's resolved theme + fonts.
// Shared by the in-app demo mount (demoMount.ts splices these into the
// opaque-origin demo document at build) and the export path (fileOps). The CSS
// *values* come from the shared demoTheme.mjs so editor/present/export can't drift.
//
// Takes config + theme + slide (not a full Presentation) so it works from the
// store-backed editor AND the prop-driven PresentSlide/presenter (which only
// carry the slide + config + theme via PresentCtx).

import type { Slide, PresentationConfig } from '../types/presentation';
import { effectiveTextPresetSize } from '../types/presentation';
import { resolveTheme } from './themes';
import {
  fontForPreset, bareFamilyName, bareNarrowFamilyName,
  resolveMonoFontPackage,
} from './fonts';
import { demoThemeVarsCss } from './demoTheme.mjs';

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
