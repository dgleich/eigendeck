// Strict sanitizer for text-element `html` (#: rich-text validation).
//
// Policy (decided): a text box may only contain what the format toolbar can
// author. Anything else — hand-written JSON, pasted foreign markup, a crafted
// `.eigendeck` — is reduced to that allowlist on every ingest (deck open, paste,
// edit commit). This is BOTH a safety fix (text html is rendered via
// dangerouslySetInnerHTML in a privileged Tauri webview, so `onerror=`/`onload=`
// handlers and `javascript:` URLs would otherwise execute when a shared deck is
// opened) AND an authoring-consistency guarantee (no styles you can't reproduce
// or edit in the UI — notably no inline font-size or background, which the
// toolbar doesn't offer).
//
// The allowlist mirrors TextFormatToolbar.tsx:
//   bold/italic/strike (b/strong/i/em/s/strike or font-weight/style + text-
//   decoration), foreColor (color, or <font color>), uppercase+tracking
//   (text-transform + letter-spacing), bullet list (ul/ol/li), justify
//   (text-align), plus the structural span/div/br/p the editor emits on edit.
// Truly arbitrary HTML/JS belongs in the (separate) sandboxed HTML widget.

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'div', 'p', 'br', 'ul', 'ol', 'li', 'font', 'code',
]);

// Tags whose ENTIRE subtree is dropped (never just unwrapped) — scripts, embeds,
// media and form controls have no place in a text box and are the dangerous set.
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math',
  'link', 'meta', 'base', 'input', 'textarea', 'button', 'select', 'option', 'form', 'audio', 'video', 'canvas',
]);

// CSS properties the toolbar can produce. Everything else (font-size, background,
// margin, padding, border*, font-family, line-height, position, …) is dropped.
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-transform', 'letter-spacing', 'text-align',
]);

const UNSAFE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import/i;

/** Filter an inline style string to the allowed presentational props. */
function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (!value || UNSAFE_VALUE.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

/** Recursively copy only allowed nodes/attrs from `src` into `dst`. */
function cleanInto(src: Node, dst: Node, doc: Document): void {
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Normalize non-breaking spaces to regular, breakable spaces. WebKit's
      // contentEditable inserts &nbsp; as you type; in edit mode it renders them
      // breakable (-webkit-nbsp-mode:space), but every OUTPUT path (SVG
      // foreignObject / HTML export / PDF) honors them as non-breaking and wraps
      // raggedly — a WYSIWYG divergence (#159). Since these are editor artifacts,
      // not intentional non-breaking spaces, fold them here on every ingest.
      dst.appendChild(doc.createTextNode((child.nodeValue || '').replace(/ /g, ' ')));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue; // drop comments etc.
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) continue; // drop subtree entirely
    if (!ALLOWED_TAGS.has(tag)) {
      cleanInto(el, dst, doc); // unwrap: keep children, drop the tag
      continue;
    }
    const clean = doc.createElement(tag);
    const style = cleanStyle(el.getAttribute('style') || '');
    if (style) clean.setAttribute('style', style);
    if (tag === 'font') {
      const color = el.getAttribute('color');
      if (color && !UNSAFE_VALUE.test(color)) clean.setAttribute('color', color);
    }
    cleanInto(el, clean, doc);
    dst.appendChild(clean);
  }
}

/**
 * Reduce a text element's `html` to the toolbar allowlist. Idempotent; returns
 * '' for empty/whitespace input. Requires a DOM (browser or jsdom).
 *
 * NOTE: pass the RAW authored html (with `$…$` / `$$…$$` math as plain text) —
 * sanitize BEFORE math is rendered to SVG, since the rendered <svg> is trusted,
 * app-generated markup that this allowlist would otherwise strip.
 */
export function sanitizeRichText(html: string | undefined | null): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r');
  if (!root) return '';
  const out = doc.createElement('div');
  cleanInto(root, out, doc);
  return out.innerHTML;
}

/**
 * Sanitize every text element's html in a presentation IN PLACE (like the
 * notebook-token migration). Returns true if anything changed. Call on deck
 * load/import so JSON-authored or foreign decks are normalized to the allowlist.
 */
export function sanitizePresentationHtml(presentation: {
  slides?: Array<{ elements?: Array<{ type?: string; html?: string }> }>;
}): boolean {
  let changed = false;
  for (const slide of presentation.slides || []) {
    for (const el of slide.elements || []) {
      if (el.type !== 'text' || typeof el.html !== 'string') continue;
      const clean = sanitizeRichText(el.html);
      if (clean !== el.html) { el.html = clean; changed = true; }
    }
  }
  return changed;
}
