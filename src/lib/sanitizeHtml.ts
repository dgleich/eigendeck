// Lazy DOMPurify wrappers for UNTRUSTED strings that get innerHTML'd into the
// privileged window from a shared .eigendeck:
//   - sanitizeSvg: the math-render cache (audit C-4) and static notebook
//     image/svg+xml output (matplotlib).
//   - sanitizeHtml: static notebook text/html output (pandas tables, styled
//     divs) and rendered markdown (audit C-1/C-2/C-5).
//   - outputHasExecutable: routes a notebook output — static content is
//     sanitized inline (here); executable content (Plotly etc.) is instead
//     mounted in an opaque-origin iframe (docs/NOTEBOOK-ISOLATION.md), never
//     sanitized-then-inlined, so it stays interactive AND contained.
//
// DOMPurify strips <script>, event handlers, and javascript: refs while keeping
// tables/headings/links/img and the <svg>/<path>/<use xlink:href="#…">/<defs> a
// real MathJax render needs. Lazy-imported (decks without math/notebooks don't
// pay for it) and needs a DOM (the app webview / jsdom).

type AttrHookData = { attrName: string; attrValue: string; keepAttr: boolean };
type Purify = {
  sanitize: (s: string, cfg?: Record<string, unknown>) => string;
  addHook?: (entry: string, cb: (node: unknown, data: AttrHookData) => void) => void;
};
let _purify: Promise<Purify | null> | null = null;

function getPurify(): Promise<Purify | null> {
  if (!_purify) {
    _purify = import('dompurify')
      .then((m) => {
        const p = (m.default ?? m) as Purify;
        // DOMPurify is inert without a DOM (its sanitize is a no-op stub). Only
        // hand back an instance that can actually filter.
        if (typeof p?.sanitize !== 'function' || p.sanitize('<svg></svg>', {}) === undefined) return null;
        // MathJax references glyph <path>s via <use>, which the svg profile drops
        // as an external-content vector. Re-allow it (see SVG_CFG) but constrain
        // its href to in-document fragment refs (#id) — that's all MathJax emits,
        // and it can't reach external/data: SVG (the actual <use> XSS).
        p.addHook?.('uponSanitizeAttribute', (node, data) => {
          if ((data.attrName === 'href' || data.attrName === 'xlink:href') && !data.attrValue.startsWith('#')) {
            // SVG elements that PULL external content (<use>/<image>/<feImage>) may
            // only reference in-document fragments (#id) — an external/data: ref is
            // the SVG-include XSS class. A normal <a href="https://…"> in html output
            // is fine, so constrain only the content-pulling elements.
            const tag = (node as Element)?.tagName?.toLowerCase?.();
            if (tag === 'use' || tag === 'image' || tag === 'feimage') data.keepAttr = false;
          }
        });
        // Any link that survives opens externally with no window.opener handle.
        p.addHook?.('afterSanitizeAttributes', (node) => {
          const el = node as Element;
          if (el?.tagName?.toLowerCase?.() === 'a' && el.getAttribute('href')) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        });
        return p;
      })
      .catch(() => null);
  }
  return _purify;
}

const SVG_CFG: Record<string, unknown> = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['xlink:href', 'href'],
};

/**
 * Sanitize an untrusted SVG string. Empty in → '' out. Fails CLOSED: if the
 * sanitizer can't load (no DOM), returns '' rather than passing raw SVG through.
 * That only happens in non-webview contexts (CLI/SSR), which don't render the
 * math cache anyway, so real math display is unaffected.
 */
export async function sanitizeSvg(svg: string | undefined | null): Promise<string> {
  if (!svg) return '';
  const purify = await getPurify();
  if (!purify) return '';
  return purify.sanitize(svg, SVG_CFG);
}

// HTML profile + inline svg (a table cell may embed an svg icon). Scripts, event
// handlers, iframes, and javascript:/data:text-html URLs are dropped.
const HTML_CFG: Record<string, unknown> = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['xlink:href', 'target'],
};

/**
 * Sanitize an untrusted HTML string (static notebook output, rendered markdown).
 * Empty in → '' out. Fails CLOSED (returns '' if the sanitizer can't load).
 */
export async function sanitizeHtml(html: string | undefined | null): Promise<string> {
  if (!html) return '';
  const purify = await getPurify();
  if (!purify) return '';
  return purify.sanitize(html, HTML_CFG);
}

// Synchronous sanitize, for the static HTML export: it renders via
// renderToStaticMarkup (no effects/await per element), so it preloads DOMPurify
// once up front, then sanitizes each output synchronously during render. Returns
// '' if not preloaded — call preloadSanitizer() first.
let _purifySync: Purify | null = null;
export async function preloadSanitizer(): Promise<void> { _purifySync = await getPurify(); }
export function sanitizeHtmlSync(html: string | undefined | null): string {
  if (!html || !_purifySync) return '';
  return _purifySync.sanitize(html, HTML_CFG);
}
export function sanitizeSvgSync(svg: string | undefined | null): string {
  if (!svg || !_purifySync) return '';
  return _purifySync.sanitize(svg, SVG_CFG);
}

// Tags that carry (or load) executable content, or CSS we won't inline into the
// privileged frame. <style>/<link> are here because a <style> block scopes an
// output's own CSS (pandas Styler / df.style is exactly this) — DOMPurify would
// strip it inline (unstyled table), and its CSS can @import/url()-exfil, so such
// output is routed to the opaque iframe where the CSS renders fully and harmlessly.
const EXEC_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'template', 'style']);

/**
 * Does this notebook `text/html` output carry executable content? If so it is
 * routed to an opaque-origin iframe (kept interactive + contained) instead of
 * being sanitized inline. False positives are harmless (an iframe still renders);
 * false negatives are impossible — anything a sanitizer would strip is detected.
 * Sync (plain DOM parse, no DOMPurify) so the render path can branch immediately.
 */
export function outputHasExecutable(html: string | undefined | null): boolean {
  if (!html || html.indexOf('<') < 0) return false;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return true; }
  // Scan the WHOLE tree, not just body: a fragment that starts with <script>
  // (or <link>/<meta>) is hoisted into <head> by the parser, so a body-only scan
  // would miss it and wrongly route executable output to the inline sanitizer.
  for (const el of Array.from(doc.documentElement?.getElementsByTagName('*') || [])) {
    if (EXEC_TAGS.has(el.tagName.toLowerCase())) return true;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) return true;
      if ((name === 'href' || name === 'src' || name === 'xlink:href')
          && /^\s*(javascript:|data:text\/html)/i.test(attr.value)) return true;
    }
  }
  return false;
}
