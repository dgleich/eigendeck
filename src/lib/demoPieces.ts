// Demo-piece name detection (#44). A multi-piece demo gates its rendering on a
// `piece` param it reads from the URL hash, e.g. `if (piece === 'force-graph')`.
// When a demo is added, we scan its HTML for those checks to auto-create one
// demo-piece element per referenced name.
//
// Single source of truth — previously this regex was copy-pasted in App.tsx,
// SlideEditor.tsx, and PropertiesPanel.tsx, and they drifted (only one used the
// hyphen-aware pattern), which is exactly how #44 slipped in.

/**
 * Unique demo-piece names referenced by `piece === '…'` / `piece == "…"` checks
 * in a demo's HTML, in first-seen order. Names may contain hyphens, digits, and
 * underscores (e.g. `force-graph`) — `[\w-]+`, NOT `\w+`, so they aren't
 * truncated at the hyphen (#44).
 */
export function extractDemoPieceNames(html: string): string[] {
  const matches = html.matchAll(/piece\s*===?\s*['"]([\w-]+)['"]/g);
  return [...new Set([...matches].map((m) => m[1]))];
}
