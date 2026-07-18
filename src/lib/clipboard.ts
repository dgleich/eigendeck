// Eigendeck clipboard interop — shared marker for round-tripping
// inline text markup (bold / italic / sub / sup / color spans)
// through copy-paste back into eigendeck text elements without
// accepting arbitrary external HTML.
//
// Producers (places that emit eigendeck HTML the user might copy):
//   - onCopy in SlideElementRenderer's contentEditable: prepends
//     the marker when the user copies a selection inside a text
//     element being edited.
//   - HTML export (renderSlideForPrint, etc.): prepends the marker
//     per text element so a full-element copy from a browser
//     viewing an exported page also trips the trusted-paste path.
//
// Consumers:
//   - onPaste in SlideElementRenderer: checks for marker in
//     clipboard's text/html; present → trust the HTML (strip
//     marker); absent → fall back to text/plain.

/** Legacy magic-comment marker for eigendeck-origin HTML. Kept for back-compat
 *  (and it works in-webview, where clipboardData round-trips verbatim), but a
 *  leading HTML comment does NOT reliably survive the macOS NSPasteboard's
 *  text/html re-serialization — so it can't be the only signal. Versioned. */
export const EIGENDECK_PASTE_MARKER = '<!--eigendeck-copy:v1-->';

/** Robust marker: a data ATTRIBUTE on a real wrapper element. Unlike a comment,
 *  a DOM attribute survives the OS clipboard's HTML re-serialization (macOS), so
 *  an eigendeck→eigendeck paste is still recognized after a native pasteboard
 *  round-trip. `div` wrapper (valid around block or inline content). */
const EIGENDECK_ATTR_MARKER = 'data-eigendeck-copy';

/** Prepend the comment marker only (no wrapper element — no layout impact).
 *  Used where the marked HTML is RENDERED (HTML export / print), so it must not
 *  alter structure; the comment is enough there because that HTML isn't put on
 *  the OS clipboard until a user copies it (and the data-attribute form is used
 *  for the in-app clipboard producers). */
export function markAsEigendeck(html: string): string {
  return EIGENDECK_PASTE_MARKER + html;
}

/** Wrap with BOTH markers for content going onto the CLIPBOARD. The data
 *  attribute survives the macOS NSPasteboard's text/html re-serialization (a
 *  leading comment does not), so an eigendeck→eigendeck paste is still routed
 *  through the trusted/element path after a native pasteboard round-trip. */
export function markAsEigendeckForClipboard(html: string): string {
  return `${EIGENDECK_PASTE_MARKER}<div ${EIGENDECK_ATTR_MARKER}="v1">${html}</div>`;
}

/** True iff the HTML carries either marker anywhere. */
export function hasEigendeckMarker(html: string): boolean {
  return html.includes(EIGENDECK_ATTR_MARKER) || html.includes(EIGENDECK_PASTE_MARKER);
}

/** Remove both markers (the comment, and the data attribute — leaving the plain
 *  wrapper div, which the sanitizer keeps) before inserting trusted HTML. */
export function stripEigendeckMarker(html: string): string {
  return html
    .split(EIGENDECK_PASTE_MARKER).join('')
    .replace(new RegExp(`\\s*${EIGENDECK_ATTR_MARKER}="v1"`, 'gi'), '');
}
