// HTML-escape a string for embedding in an iframe `srcdoc` attribute. Security-
// relevant (it's what keeps demo/notebook HTML from breaking out of the srcdoc),
// so it lives in ONE place — shared by the HTML export (exportCore.mjs) and the
// notebook export (notebookExport.tsx), which each used to keep their own copy.
export function htmlEscapeForSrcdoc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape ANY value for an HTML attribute / style ("<>& → entities). Coerces to
 *  string first, so geometry numbers are safe too. The canonical attribute escaper
 *  shared by the export builders (elementHtml / arrowGeometry / exportCore). */
export function escAttr(v) {
  return htmlEscapeForSrcdoc(String(v));
}

/** URL policy for an exported href/src. Attribute-escaping does NOT stop a
 *  `javascript:`/`vbscript:` URL (no breakout chars), so restrict schemes: only
 *  http(s) — and `data:` for images when `allowData` — pass; anything else returns
 *  '' so the exported link/media is inert. Protocol-relative `//host` → https. */
export function safeExportUrl(url, { allowData = false } = {}) {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return 'https:' + s;
  if (allowData && /^data:/i.test(s)) return s;
  return '';
}
