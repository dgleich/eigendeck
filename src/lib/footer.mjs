// Shared slide-footer helpers, so the FOUR independent footer render paths
// (SlideEditor, PresentMode, exportCore, printSlideHtml) stay consistent — the
// same drift class as element rendering (see docs/ELEMENT-CHECKLIST.md). #135.
import { resolveFontPackage } from './fontRegistry.mjs';

// Preserve the historical default (PT Sans) when a deck sets no footerFont, so
// existing decks render exactly as before.
export const FOOTER_DEFAULT_FONT_ID = 'ptsans';

/** CSS font-family string for the deck footer (meta + number).
 *  `config.footerFont` (a font id) selects it; unset → PT Sans (current behavior). */
export function footerFontFamily(config) {
  return resolveFontPackage((config && config.footerFont) || FOOTER_DEFAULT_FONT_ID).family;
}

/** Whether a slide draws its footer. Per-slide `omitFooter` hides both the
 *  author·venue meta and the slide number (numbering keeps counting through it). */
export function showFooter(slide) {
  return !(slide && slide.omitFooter);
}
