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

// A REAL CSS color: hex, an rgb/rgba/hsl/hsla function with numeric args, or a bare
// keyword (named colors, `transparent`, `currentColor`, theme tokens like `accent`).
// Deliberately NOT breakout-char filtering — `isSafeCssValue` accepts `url(...)`, which
// in a `color`/`background` field loads a network resource (a beacon in an exported
// artifact). This rejects `url(`/`@import`/expressions and only permits real colors.
const COLOR_HEX = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_FUNC = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]*\)$/i;
const COLOR_KEYWORD = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/** True when `v` is a genuine CSS color (not `url()`/`@import`/injection). */
export function isSafeColor(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '') return false;
  return COLOR_HEX.test(s) || COLOR_FUNC.test(s) || COLOR_KEYWORD.test(s);
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
  // Never THROW on malformed structure (null / non-object / a string where an object
  // is expected) — drop it. A throw would abort the whole normalize pass mid-slide and
  // (per the non-fatal deck-open catch) leave EARLIER unsafe elements installed.
  if (!el || typeof el !== 'object') return null;

  // Geometry is string-concatenated into text SVG (viewBox/width/height) and used
  // as layout everywhere; require finite numbers for every element type.
  const p = (el as { position?: unknown }).position as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
  if (!p || typeof p !== 'object' || !isFiniteNum(p.x) || !isFiniteNum(p.y) || !isFiniteNum(p.width) || !isFiniteNum(p.height)) return null;

  // `padding`, when present, is spliced into the SVG style (textPaddingCss) — every
  // side must be a finite number.
  const pad = (el as { padding?: unknown }).padding;
  if (pad != null) {
    const pp = pad as { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown };
    if (typeof pad !== 'object' || !isFiniteNum(pp.top) || !isFiniteNum(pp.right) || !isFiniteNum(pp.bottom) || !isFiniteNum(pp.left)) return null;
  }

  // `color` and `backgroundColor` reach CSS `color:`/`background:` — they must be REAL
  // colors, not `url()`/`@import` (which would load a network resource in an export
  // artifact) and not a breakout. Validate wherever present (a non-empty string).
  const anyEl = el as unknown as Record<string, unknown> & { fontFamily?: unknown; fontSize?: unknown; html?: unknown; type?: string };
  if (typeof anyEl.color === 'string' && (anyEl.color as string).trim() !== '' && !isSafeColor(anyEl.color)) return null;
  if (typeof anyEl.backgroundColor === 'string' && (anyEl.backgroundColor as string).trim() !== '' && !isSafeColor(anyEl.backgroundColor)) return null;

  // Optional numeric visual fields that reach a CSS/SVG numeric (opacity, rotate(),
  // border-radius, rgba() alpha, arrow stroke/head) — finite if present, else drop.
  for (const k of ['rotation', 'borderRadius', 'opacity', 'backgroundOpacity', 'strokeWidth', 'headSize']) {
    if (anyEl[k] != null && !isFiniteNum(anyEl[k])) return null;
  }

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
  slides?: unknown;
  config?: { textSizes?: Record<string, unknown> };
}): number {
  let dropped = 0;
  const slides = Array.isArray(presentation.slides) ? (presentation.slides as Array<{ elements?: unknown }>) : [];
  for (const slide of slides) {
    if (!slide || !Array.isArray(slide.elements)) continue;
    const els = slide.elements as SlideElement[];
    const kept = els.filter((el) => normalizeUntrustedElement(el) !== null);
    if (kept.length !== els.length) {
      dropped += els.length - kept.length;
      (slide as { elements: SlideElement[] }).elements = kept;
    }
  }
  // Deck-level config.textSizes feeds effectiveFontSize() → the same SVG style, so a
  // named size (element.fontSizeName / a preset's size) can resolve to an UNTRUSTED
  // value here. Drop any non-finite entry so it can never reach the sink as a string;
  // effectiveFontSize then falls back to the built-in default for that name.
  const ts = presentation.config?.textSizes;
  if (ts && typeof ts === 'object') {
    for (const k of Object.keys(ts)) if (!isFiniteNum((ts as Record<string, unknown>)[k])) delete (ts as Record<string, unknown>)[k];
  }
  return dropped;
}

export type { Presentation };
