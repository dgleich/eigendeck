// Build a text element's `html` from a plain/styled-text paste (#161).
//
// When a paste onto the canvas has no image, isn't an Eigendeck-internal paste,
// and isn't block-structured HTML (tables/lists/formatted blocks — those go to
// the screenshot path), we create an editable text element from the text. This
// is the pure decision: given the clipboard's text/html and text/plain, produce
// the element html, or null when there's nothing usable.
//
// Styling policy is the format toolbar's allowlist via sanitizeRichText: keep
// bold/italic/underline/strike, foreground color, uppercase + letter-spacing,
// alignment and lists; DROP inline font-size and font-family (the pasted text
// adopts the target preset's size). See sanitizeRichText.ts.

import { sanitizeRichText } from './sanitizeRichText';

/** Escape plain text for use as element html, preserving line breaks. */
function plainToHtml(plain: string): string {
  return plain
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Prefer text/html (sanitized to the authorable allowlist); fall back to
 * text/plain (escaped, newlines → <br>). Returns null when both are empty —
 * including the case where the html sanitizes down to nothing (e.g. it was only
 * an <img>), so the caller can still use the plain text.
 */
export function pasteTextToElementHtml(
  html: string | null | undefined,
  plain: string | null | undefined,
): string | null {
  const h = (html || '').trim();
  if (h) {
    const clean = sanitizeRichText(h).trim();
    if (clean) return clean;
  }
  const p = plain || '';
  if (p.trim()) return plainToHtml(p);
  return null;
}
