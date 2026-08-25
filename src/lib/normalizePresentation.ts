// Fail-closed normalization for UNTRUSTED presentation content (audit H-1 + C-2).
//
// A .eigendeck is attacker-controllable data, and element `data` is parsed as
// arbitrary JSON with no runtime schema check — TypeScript types are compile-time
// only. Two sinks make that dangerous:
//   - element.html is rendered via dangerouslySetInnerHTML (the rich-text sanitizer
//     handles this — see sanitizeRichText); and
//   - element PROPERTIES (fontFamily, color, geometry) are string-interpolated into
//     the SVG/markup that buildTextElementSvgMarkup produces and then
//     dangerouslySetInnerHTML'd in the PRIVILEGED frame. A crafted fontFamily/color
//     containing a `"`/`<`/`>` breaks out of the style attribute and injects a tag
//     (e.g. <img onerror>), so a payload in a property bypasses the html sanitizer
//     and fires automatically on display (C-2).
//
// This is the ONE boundary to run at EVERY untrusted ingress (deck open/import,
// undo-seed, history restore, clipboard paste). It sanitizes text html and validates
// each property against its known-safe shape, DROPPING any element whose values fall
// outside it (fail-closed). It is transparent to legitimate decks: real fonts/colors/
// numbers all pass, so nothing a normal deck contains is altered or dropped.

import { sanitizeRichText } from './sanitizeRichText';
import type { Presentation, SlideElement } from '../types/presentation';

// Characters that let a value escape the CSS declaration / HTML style attribute /
// SVG attribute it's interpolated into: close the attribute ("), end/inject a CSS
// declaration (; { }), open/close a tag (< >), or use an escape (\ `). Legit CSS
// font stacks ('PT Sans', sans-serif) and colors (#0af, rgb(0,0,0), red) contain
// NONE of these — they use only letters, digits, spaces, commas, dots, %, ()
// (rgb/hsl), hyphens and single-quotes. Control chars (< 0x20, 0x7f) are rejected too.
const CSS_BREAKOUT = new Set(['<', '>', '"', '`', ';', '{', '}', '\\']);

/** A string safe to interpolate into a CSS value / style / SVG attribute (no breakout). */
export function isSafeCssValue(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false; // control chars
    if (CSS_BREAKOUT.has(s[i])) return false;        // breakout chars
  }
  return true;
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Validate ONE untrusted element. Returns the element (possibly with its html
 * sanitized in place) if it is safe to render, or `null` if it must be dropped
 * (a value outside its known-safe shape).
 */
export function normalizeUntrustedElement(el: SlideElement): SlideElement | null {
  // Geometry is string-concatenated into text SVG (viewBox/width/height) and used
  // as layout everywhere; require finite numbers for every element type.
  const p = (el as { position?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } }).position;
  if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y) || !isFiniteNum(p.width) || !isFiniteNum(p.height)) return null;

  // `color` is a shared field (text, arrow, cover, …) that reaches CSS/markup —
  // validate wherever present.
  const anyEl = el as { color?: unknown; fontFamily?: unknown; fontSize?: unknown; html?: unknown; type?: string };
  if (anyEl.color != null && !isSafeCssValue(anyEl.color)) return null;

  if (anyEl.type === 'text') {
    if (anyEl.fontFamily != null && !isSafeCssValue(anyEl.fontFamily)) return null;
    if (anyEl.fontSize != null && !isFiniteNum(anyEl.fontSize)) return null;
    if (typeof anyEl.html === 'string') anyEl.html = sanitizeRichText(anyEl.html);
  }
  return el;
}

/**
 * Normalize a whole untrusted presentation IN PLACE: sanitize text html and drop
 * every element whose properties fall outside their known-safe shape. Idempotent.
 * Returns the number of elements dropped (0 for a clean deck).
 */
export function normalizeUntrustedPresentation(presentation: {
  slides?: Array<{ elements?: SlideElement[] }>;
}): number {
  let dropped = 0;
  for (const slide of presentation.slides || []) {
    if (!slide.elements) continue;
    const kept = slide.elements.filter((el) => normalizeUntrustedElement(el) !== null);
    if (kept.length !== slide.elements.length) {
      dropped += slide.elements.length - kept.length;
      slide.elements = kept;
    }
  }
  return dropped;
}

export type { Presentation };
