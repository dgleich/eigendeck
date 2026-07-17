// How a `.html` file dropped onto a slide (from Finder / the OS) is routed.
//
// A dropped `.html` is ambiguous: it may be an Eigendeck *demo* (embed it as a
// demo / demo-piece asset) or just a plain HTML snippet the user wants on the
// slide as an `html` element (#137). This is the single decision point, kept
// pure so it can be unit-tested without the Tauri drag-drop plumbing. The
// SlideEditor drop handler owns the side effects (reading bytes, storing the
// asset, adding elements, toasting); it asks this function only "what is it?".

import { isEigendeckDemo } from './assetTypes.mjs';
import { extractDemoPieceNames } from './demoPieces';
import { validateHtmlSnippet } from './htmlSnippet';

export type DroppedHtmlRoute =
  /** A marked, multi-piece demo — one demo-piece element per referenced name. */
  | { kind: 'demo-pieces'; pieces: string[] }
  /** A marked single-frame demo. */
  | { kind: 'demo' }
  /** Not a demo, but a usable raw-HTML snippet → insert an `html` element. */
  | { kind: 'html-element'; html: string; interactive: boolean }
  /** Not a demo and not a usable snippet → reject with reasons for a toast. */
  | { kind: 'reject'; problems: string[] };

/**
 * Classify the text of a dropped `.html` file. The Eigendeck-demo marker wins:
 * only a non-demo file falls back to the `html`-element path. A multi-piece demo
 * is one that both references `piece === '…'` checks AND uses BroadcastChannel
 * (the piece-coordination transport) — matching the original insertion logic.
 */
export function classifyDroppedHtml(html: string): DroppedHtmlRoute {
  if (isEigendeckDemo(html).ok) {
    const pieces = extractDemoPieceNames(html);
    if (pieces.length > 0 && html.includes('BroadcastChannel')) {
      return { kind: 'demo-pieces', pieces };
    }
    return { kind: 'demo' };
  }
  const v = validateHtmlSnippet(html);
  if (v.ok) return { kind: 'html-element', html: v.html, interactive: v.interactive };
  return { kind: 'reject', problems: v.problems };
}
