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

/** Magic-comment marker for eigendeck-origin HTML. Survives WebKit
 *  clipboard sanitization cleanly (custom MIME types can be
 *  stripped). Invisible in render — HTML comments are skipped by
 *  parsers. Versioned so the format can evolve. */
export const EIGENDECK_PASTE_MARKER = '<!--eigendeck-copy:v1-->';

/** Prepend the marker to an HTML fragment. */
export function markAsEigendeck(html: string): string {
  return EIGENDECK_PASTE_MARKER + html;
}

/** True iff the HTML carries our marker anywhere. */
export function hasEigendeckMarker(html: string): boolean {
  return html.includes(EIGENDECK_PASTE_MARKER);
}

/** Remove every instance of the marker (for use just before
 *  inserting trusted HTML into a destination element). */
export function stripEigendeckMarker(html: string): string {
  return html.split(EIGENDECK_PASTE_MARKER).join('');
}
