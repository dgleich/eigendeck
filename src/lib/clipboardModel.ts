// The private Eigendeck clipboard "flavor".
//
// Per docs/copy-and-paste.md: we stop keeping a separate authoritative in-memory
// buffer (clipboardRef) and instead carry the copied element(s)/slide as JSON on
// the OS clipboard, base64-embedded in the text/html representation behind our
// marker. On paste we decode it FIRST — so an internal copy round-trips with full
// fidelity (references included) straight from the clipboard, with nothing to go
// stale. (Figma's technique; when copy later routes through Rust NSPasteboard we
// can promote this to a real custom UTI.)
//
// The codec is pure + unit-tested. Encoding/reading the actual clipboard, and
// re-resolving links/sync on paste, live in the copy/paste handlers.

import type { SlideElement } from '../types/presentation';

const MARKER_ATTR = 'data-eigendeck-copy';
const JSON_ATTR = 'data-eigendeck-json';
export const CLIP_VERSION = 1;

/** The copied objects. `elements` for one-or-more elements (their JSON carries
 *  link/sync metadata); `slide` for a whole-slide copy. `from*` records the
 *  origin so paste can decide independent-copy vs re-link vs new-slide. */
export interface EigendeckClip {
  v: number;
  kind: 'elements' | 'slide';
  elements?: SlideElement[];
  slide?: unknown;
  fromSlideId?: string;
  fromSlideIndex?: number;
}

// UTF-8-safe base64 (non-ASCII in text content would corrupt a plain btoa/atob).
function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(b: string): string {
  return decodeURIComponent(escape(atob(b)));
}

/**
 * Wrap `visibleHtml` (what foreign apps see + the styled fallback) with the
 * Eigendeck marker AND the base64 clip payload. The marker attribute keeps the
 * existing hasEigendeckMarker() detection working; the json attribute is the
 * high-fidelity private flavor.
 */
export function encodeClipHtml(clip: Omit<EigendeckClip, 'v'>, visibleHtml: string): string {
  const json = b64encode(JSON.stringify({ v: CLIP_VERSION, ...clip }));
  return `<div ${MARKER_ATTR}="v1" ${JSON_ATTR}="${json}">${visibleHtml}</div>`;
}

/**
 * Decode the Eigendeck clip from pasted HTML (from the native pasteboard or
 * clipboardData). Returns null when the payload is absent or malformed — e.g.
 * foreign HTML, or an Eigendeck *text-run* copy that carries the marker but no
 * element/slide payload (that pastes as a new text box, not objects).
 */
export function decodeClipHtml(html: string | null | undefined): EigendeckClip | null {
  if (!html) return null;
  const m = html.match(new RegExp(`${JSON_ATTR}="([A-Za-z0-9+/=]+)"`));
  if (!m) return null;
  try {
    const clip = JSON.parse(b64decode(m[1])) as EigendeckClip;
    if (!clip || (clip.kind !== 'elements' && clip.kind !== 'slide')) return null;
    if (clip.kind === 'elements' && !Array.isArray(clip.elements)) return null;
    return clip;
  } catch {
    return null;
  }
}
