// Build a text element's `html` from a plain/styled-text paste (#161).
//
// When a paste onto the canvas has no image, isn't an Eigendeck-internal paste,
// and isn't block-structured HTML (tables/lists/formatted blocks — those go to
// the screenshot path), we create an editable text element from the text. This
// is the pure decision: given the clipboard's text/html and text/plain, produce
// the element html, or null when there's nothing usable.
//
// Styling policy (docs/copy-and-paste.md): keep only what the format toolbar can
// author — bold / italic / strikethrough, foreground color, uppercase + letter-
// spacing, alignment, lists. sanitizeRichText already DROPS font-size + font-
// family (pasted text adopts the target preset). On top of that, for a PASTE we:
//   - strip a color applied to the WHOLE string (a source default — Word's black,
//     WebKit's baked neutral black — invisible on themed slides), so it inherits
//     the deck theme; keep colors on SUB-RANGES (intentional highlights);
//   - drop underline (Eigendeck has none), keeping line-through (strikethrough).

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

/** Post-sanitize paste normalization: drop a whole-string color + underline.
 *  (Element-copy paste preserves color via the private flavor — this only runs
 *  in the text-branch paste, foreign or edit-mode text-run.) */
function normalizePastedStyles(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const rootText = doc.body.textContent || '';
  doc.body.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    // A color on an element that wraps the ENTIRE text is a blanket default → drop.
    if (el.style.color && (el.textContent || '') === rootText) el.style.removeProperty('color');
    // Underline is not authorable in Eigendeck — strip it, keep line-through.
    const td = el.style.textDecoration || el.style.getPropertyValue('text-decoration-line');
    if (td && /underline/i.test(td)) {
      const kept = td.replace(/underline/ig, '').replace(/\s+/g, ' ').trim();
      el.style.removeProperty('text-decoration');
      el.style.removeProperty('text-decoration-line');
      if (kept) el.style.textDecoration = kept;
    }
    if (!(el.getAttribute('style') || '').trim()) el.removeAttribute('style');
  });
  doc.body.querySelectorAll('font[color]').forEach((el) => {
    if ((el.textContent || '') === rootText) el.removeAttribute('color');
  });
  // <u> → unwrap (no underline element in Eigendeck).
  doc.body.querySelectorAll('u').forEach((u) => {
    const parent = u.parentNode;
    if (!parent) return;
    while (u.firstChild) parent.insertBefore(u.firstChild, u);
    parent.removeChild(u);
  });
  return doc.body.innerHTML;
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
    const clean = normalizePastedStyles(sanitizeRichText(h)).trim();
    if (clean) return clean;
  }
  const p = plain || '';
  if (p.trim()) return plainToHtml(p);
  return null;
}
