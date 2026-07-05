// Lazy DOMPurify wrapper for UNTRUSTED SVG that gets innerHTML'd into the
// privileged window. Today that's the math-render cache: a shared .eigendeck can
// ship a poisoned `math_cache` row whose "SVG" carries <script> or a
// <foreignObject> with an onerror handler, which would otherwise run with Tauri
// IPC access when the equation renders (audit C-4).
//
// DOMPurify's SVG profile strips <script>, event handlers, javascript: refs, and
// external/foreignObject escapes while preserving the <svg>/<g>/<path>/<use
// xlink:href="#…">/<defs> that a real MathJax render needs. It's lazy-imported so
// decks without math don't pay for it, and needs a DOM (the app webview / jsdom).

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
        p.addHook?.('uponSanitizeAttribute', (_node, data) => {
          if ((data.attrName === 'href' || data.attrName === 'xlink:href') && !data.attrValue.startsWith('#')) {
            data.keepAttr = false;
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
