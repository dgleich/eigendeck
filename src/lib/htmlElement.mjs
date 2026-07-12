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
    + `<style>html,body{margin:0;padding:0;height:100%;background:${bg};box-sizing:border-box;}*{box-sizing:border-box;}</style>`
    + `</head><body>${body}</body></html>`;
}

/** The `<iframe>` HTML string for string-render targets (HTML export, PDF inline).
 *  `styleStr` positions/sizes the frame; `sandbox` defaults to the locked policy. */
export function htmlElementIframeHtml(el, styleStr, sandbox = HTML_SANDBOX_LOCKED) {
  const srcdoc = htmlEscapeForSrcdoc(htmlElementSrcdoc(el.html, el.background));
  return `<iframe srcdoc="${srcdoc}" style="${styleStr}" sandbox="${sandbox}"></iframe>`;
}
