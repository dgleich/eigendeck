// Raw-HTML element (#137) — the ONE place the sandbox + CSP for the general HTML
// escape hatch are defined, shared by every render path and the HTML export so
// the isolation can never drift. The element renders arbitrary markup inside a
// sandboxed <iframe srcdoc>; safety comes from the browser, not a sanitizer:
//
//   • NO `allow-scripts` in the sandbox → zero JavaScript runs (inline handlers
//     like onerror can't fire either), and the framed doc can't drop its own
//     sandbox. This is the whole no-script guarantee.
//   • An injected CSP blocks ALL network — only data: URIs for images/media/fonts
//     and inline styles are allowed. No egress, so decks stay offline-portable
//     and can't leak IPs / load trackers.
//
// The editor uses the `allow-same-origin` sandbox (still WITHOUT allow-scripts,
// which is the safe combination) so the parent can reach into contentDocument and
// toggle contentEditable for best-effort in-canvas editing. Every non-editing
// target (present, export, thumbnail) uses the fully-locked empty sandbox.
import { htmlEscapeForSrcdoc } from './htmlEscape.mjs';

/** Fully locked: no scripts, no same-origin, no network. Present / export / thumb. */
export const HTML_SANDBOX_LOCKED = '';

/** Editor only: still script-less (safe), but same-origin so the parent can toggle
 *  contentEditable on the iframe's document. NEVER add allow-scripts here — the
 *  allow-scripts + allow-same-origin combination lets the frame remove its sandbox. */
export const HTML_SANDBOX_EDITABLE = 'allow-same-origin';

/** CSP injected into every srcdoc: block all network, allow only inline styles and
 *  data: URIs. Defence-in-depth alongside the no-script sandbox. */
export const HTML_ELEMENT_CSP =
  "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none';";

/** Wrap raw HTML into a full srcdoc document carrying the CSP. Transparent body so
 *  the element composites onto the slide; a per-element `background` can override. */
export function htmlElementSrcdoc(rawHtml, background) {
  const body = typeof rawHtml === 'string' ? rawHtml : '';
  const bg = background ? String(background).replace(/[<>"]/g, '') : 'transparent';
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${HTML_ELEMENT_CSP}">`
    // print-color-adjust:exact so the iframe's backgrounds/gradients/fills survive
    // print/PDF — the parent's print-color-adjust does NOT cascade into a sandboxed
    // iframe, so without this the element loses its background + colours in print (#137).
    + `<style>html,body{margin:0;padding:0;height:100%;background:${bg};box-sizing:border-box;`
    + `-webkit-print-color-adjust:exact;print-color-adjust:exact;}*{box-sizing:border-box;}</style>`
    + `</head><body>${body}</body></html>`;
}

/** The `<iframe>` HTML string for string-render targets (HTML export, PDF inline).
 *  `styleStr` positions/sizes the frame; `sandbox` defaults to the locked policy. */
export function htmlElementIframeHtml(el, styleStr, sandbox = HTML_SANDBOX_LOCKED) {
  const srcdoc = htmlEscapeForSrcdoc(htmlElementSrcdoc(el.html, el.background));
  return `<iframe srcdoc="${srcdoc}" style="${styleStr}" sandbox="${sandbox}"></iframe>`;
}

/** Scale-mode iframe for string-render targets (HTML export, PDF/print). `boxStyleStr`
 *  positions the (clipping) wrapper in the caller's units; `L` carries the design
 *  size + centering offsets ALREADY in `unit` (px for export, in for print) and the
 *  unitless `scale`. Mirrors the DOM paths' wrapper+transform. */
export function htmlElementScaledIframeHtml(el, boxStyleStr, L, unit = 'px', sandbox = HTML_SANDBOX_LOCKED) {
  const srcdoc = htmlEscapeForSrcdoc(htmlElementSrcdoc(el.html, el.background));
  const iframeStyle =
    `position:absolute;left:0;top:0;width:${L.designW}${unit};height:${L.designH}${unit};`
    + 'border:none;background:transparent;'
    + `transform:translate(${L.offsetX}${unit},${L.offsetY}${unit}) scale(${L.scale});transform-origin:top left;`;
  return `<div style="${boxStyleStr};overflow:hidden;">`
    + `<iframe srcdoc="${srcdoc}" style="${iframeStyle}" sandbox="${sandbox}"></iframe></div>`;
}

/** Whether the element opts into contain-scaling (needs both the flag and a design
 *  size to compare the box against). */
export function htmlIsScaled(el) {
  return !!(el && el.scaleMode && el.scaleW > 0 && el.scaleH > 0);
}

/** Contain-scale layout for a scale-mode html element (#137). Given the live box
 *  (bw×bh) and the captured design size (sw×sh), returns the UNIFORM scale factor
 *  (aspect preserved) and the centering offset that fits the design-size content
 *  inside the box, letterboxed. `scale` is a pure ratio; `designW/H` and
 *  `offsetX/Y` are lengths in the SAME unit as the box — so a caller working in
 *  other units (print inches) converts those lengths and leaves `scale` as-is.
 *  Missing/degenerate design size falls back to the box (scale 1 = no-op). */
export function htmlScaleLayout(bw, bh, sw, sh) {
  const designW = sw > 0 ? sw : bw;
  const designH = sh > 0 ? sh : bh;
  const scaleRaw = designW > 0 && designH > 0 ? Math.min(bw / designW, bh / designH) : 1;
  // Round for clean CSS output (avoid float noise like -3.5e-15px / 0.5499999…):
  // offsets to whole px (sub-px centering is imperceptible), scale to 4 decimals.
  return {
    designW, designH,
    scale: Math.round(scaleRaw * 1e4) / 1e4,
    offsetX: Math.round((bw - designW * scaleRaw) / 2),
    offsetY: Math.round((bh - designH * scaleRaw) / 2),
  };
}
