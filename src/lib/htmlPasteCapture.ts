// General "paste HTML as a picture" support.
//
// When rich HTML is pasted onto the canvas (a table, list, formatted block —
// e.g. from Google Sheets/Docs, a browser, Word), we render it in an offscreen
// DOM node styled with the deck font, then SCREENSHOT that node to a PNG via
// modern-screenshot (the same rasterizer capturePreview uses for notebooks),
// and insert the PNG as a normal image. The browser does the layout, so this
// handles arbitrary HTML — far more robust than reverse-engineering one app's
// table markup. The result is a static image: thumbnails / present / export
// all work for free.
//
// Deck font as default: we strip the source font-family so the deck body font
// applies (keeps bold/italic/color/background/borders/alignment — just unifies
// the typeface so pastes look on-brand). Scripts / event handlers / javascript:
// URLs are stripped before rendering.

/** Does this pasted HTML contain structure a text box CAN'T represent — a real
 *  TABLE, an image, or preformatted/SVG/MathML content? Those go to the screenshot
 *  path. Everything else (paragraphs, <div>/<span> wrappers, bold/italic/color,
 *  headings, lists) is representable as an editable text element via
 *  sanitizeRichText's allowlist, so it must NOT screenshot. This is deliberately
 *  narrow: Word and browsers wrap even a one-line styled sentence in <p>/<div>,
 *  which should still paste as editable text, not an image (#161). */
export function htmlNeedsScreenshot(html: string | null | undefined): boolean {
  return !!html && /<(table|thead|tbody|tfoot|tr|td|th|img|svg|figure|pre|math)[\s>]/i.test(html);
}

/** Pull the FIRST embedded data-URL `<img>` out of pasted HTML (#158). Google
 *  Slides (and similar) put no image on the clipboard — only `text/html` with an
 *  `<img src="data:image/…;base64,…">` inside a `<b docs-internal-guid>` wrapper,
 *  so the clipboard image-item paths all miss. Returns the decoded bytes + mime,
 *  or null when there's no data-URL image (leave it to the rich-HTML fallback).
 *  Pure string/base64 work — no DOM — so it runs anywhere and is unit-testable. */
export function extractPastedDataUrlImage(
  html: string | null | undefined,
): { mime: string; bytes: Uint8Array } | null {
  if (!html) return null;
  const m = html.match(/<img\b[^>]*\bsrc\s*=\s*["']data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)["']/i);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2].replace(/\s+/g, '');
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.length ? { mime, bytes } : null;
  } catch {
    return null; // malformed base64
  }
}

/** Strip scripts / handlers / js: URLs and the source font-family, returning
 *  body innerHTML safe to drop into an offscreen render node. DOM required. */
export function sanitizeForCapture(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, link, meta, title, base, iframe, object, embed').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    const style = (el as HTMLElement).style;
    if (style && style.fontFamily) style.fontFamily = ''; // deck font becomes the default
  });
  return doc.body.innerHTML;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface CapturedHtml {
  bytes: Uint8Array;
  /** CSS px size of the rendered content (for aspect ratio / on-slide sizing). */
  width: number;
  height: number;
}

/**
 * Render sanitized HTML offscreen in the deck font and screenshot it to a PNG.
 * Returns null if nothing renders. Requires a browser/Tauri DOM + canvas.
 */
export async function captureHtmlToPng(
  html: string,
  opts: { fontFamily: string; scale?: number; maxWidth?: number } = { fontFamily: 'sans-serif' },
): Promise<CapturedHtml | null> {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed; left:-99999px; top:0; z-index:-1; display:inline-block; ` +
    `max-width:${opts.maxWidth ?? 1400}px; background:#ffffff; color:#1a1a1a; ` +
    `font-family:${opts.fontFamily}; line-height:1.3;`;
  container.innerHTML = sanitizeForCapture(html);
  document.body.appendChild(container);
  try {
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const { domToDataUrl } = await import('modern-screenshot');
    const dataUrl = await domToDataUrl(container, { scale: opts.scale ?? 4, backgroundColor: '#ffffff' });
    return { bytes: dataUrlToBytes(dataUrl), width: Math.round(rect.width), height: Math.round(rect.height) };
  } catch (e) {
    console.warn('captureHtmlToPng failed:', e);
    return null;
  } finally {
    container.remove();
  }
}
