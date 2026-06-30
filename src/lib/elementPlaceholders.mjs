// Appearance of the "live preview unavailable" placeholder for heavy element
// types (shown when a demo/demo-piece/notebook has no cached preview yet). The
// semantic identity — which color + label means "notebook" vs "demo" — is shared
// here so the sidebar thumbnail (SlideThumbnail), the link-target picker
// (LinkOverlay), and the HTML export (exportCore) agree. Font SIZE is left to each
// caller because it's tuned to that surface's render scale, not part of the
// element's identity. (demo-piece shows the piece name, so its label is '' here.)
//
// Before this was shared, the copies had already drifted — LinkOverlay drew the
// notebook "NB" in #3f9142 while everywhere else used #86c986.
export const ELEMENT_PLACEHOLDERS = {
  demo:         { label: 'DEMO', color: '#60a5fa', bg: '#e8f4f8', borderColor: '#93c5fd' },
  'demo-piece': { label: '',     color: '#7c3aed', bg: '#f0e8f8', borderColor: '#a78bfa' },
  notebook:     { label: 'NB',   color: '#86c986', bg: '#eef7ee', borderColor: '#86c986' },
};
