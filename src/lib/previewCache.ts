// Cached PNG previews of an element's rendered contents, stored in the SQLite
// asset_cache (variant 'preview'), keyed by the element's sync identity
// (syncId ?? id) — synced instances look identical and share one preview, the
// same keying useOverlay uses. Captured proactively (debounced, while the
// element is on-screen in the editor) so static export / pickers / thumbnails
// can read a picture without a live render or a slide-by-slide capture pass.
//
// Element-type-agnostic on purpose: notebooks today, demos next (see
// .claude/notes/notebook-preview-cache-design.md). The only type-specific bit
// is when to recapture, which the caller drives.

import { invoke } from '@tauri-apps/api/core';
import type { SlideElement } from '../types/presentation';
import { bytesToBase64 } from './base64';

/** The cache key for an element's preview: its sync identity. */
export function previewKey(el: Pick<SlideElement, 'id' | 'syncId'>): string {
  return el.syncId ?? el.id;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// One in-flight capture per key (StrictMode / rapid edits would otherwise
// double-capture the same element).
const inflight = new Set<string>();

// Last source_hash captured this session per key — lets us skip the expensive
// domToDataUrl when the to-be-captured content + size are unchanged.
const lastHash = new Map<string, string>();

/** Fast non-crypto string hash (cyrb53) — ample as a cache-bust key. */
function hashString(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Capture the element's rendered content to a PNG and store it as the cached
 *  preview. Captures `[data-element-id=el.id]`, or — when `innerSelector` is
 *  given — that descendant (e.g. '.nb-frame', so authoring chrome on the outer
 *  DraggableBox is excluded). No-op if not mounted / no size. Never throws.
 *
 *  `cacheSalt` is mixed into the change-detection hash for content that affects
 *  the picture but ISN'T in the captured node's own HTML — e.g. a demo's theme
 *  (#86) is injected as CSS vars in the iframe's <head>, so a theme switch leaves
 *  the captured <body> HTML identical and would otherwise never recapture.
 *
 *  `backgroundColor` fills the capture's backdrop. A demo iframe is TRANSPARENT
 *  (so the slide shows through live); without this the rasterized PNG keeps that
 *  transparency and reads as the app's grey wherever it's shown standalone
 *  (sidebar / link picker / export). Pass the slide's resolved background so the
 *  thumbnail matches the slide. It's folded into the cache hash too, so changing
 *  the slide theme re-captures with the new backdrop. */
export async function capturePreview(
  el: SlideElement, innerSelector?: string, cacheSalt?: string,
  backgroundColor?: string,
): Promise<void> {
  const key = previewKey(el);
  if (inflight.has(key)) return;
  const host = document.querySelector(`[data-element-id="${el.id}"]`) as HTMLElement | null;
  if (!host) return;
  let node: HTMLElement = (innerSelector
    ? (host.querySelector(innerSelector) as HTMLElement | null)
    : host) ?? host;
  // A demo renders in a (same-origin, blob:) sandboxed iframe. The <iframe>
  // element is opaque to DOM cloning, so capture its inner document instead —
  // allow-same-origin lets the parent reach contentDocument. Bail silently if
  // it's unreachable (cross-origin) or not loaded yet.
  if (node instanceof HTMLIFrameElement) {
    const doc = node.contentDocument;
    const root = doc?.body ?? doc?.documentElement ?? null;
    if (!root) return;
    node = root as HTMLElement;
  }
  const width = Math.round(el.position.width);
  const height = Math.round(el.position.height);
  if (!width || !height) return;

  // Skip the (expensive) rasterization when the content + size are unchanged
  // since the last capture. The hash is over the to-be-captured node's HTML +
  // size, so it changes exactly when the picture's structure does. (Canvas
  // pixel state isn't in the HTML — acceptable: a thumbnail is a single frame.)
  const sig = hashString(`${width}x${height}|${cacheSalt ?? ''}|${backgroundColor ?? ''}|${node.outerHTML}`);
  if (lastHash.get(key) === sig) return;
  try {
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId: key });
    const ex = variants.find((v) => v.variant === 'preview' && v.width === width && v.height === height);
    if (ex && ex.source_hash === sig) { lastHash.set(key, sig); return; }  // persisted + unchanged
  } catch { /* fall through and (re)capture */ }

  inflight.add(key);
  try {
    const { domToDataUrl } = await import('modern-screenshot');
    const dataUrl = await domToDataUrl(node, { width, height, scale: 1, backgroundColor });
    const bytes = dataUrlToBytes(dataUrl);
    await invoke('db_put_asset_cache', {
      sourceId: key,
      variant: 'preview',
      width,
      height,
      png: Array.from(bytes),
      sourceHash: sig,
    });
    lastHash.set(key, sig);
    bumpPreviewVersion(key);
  } catch (e) {
    console.warn('capturePreview failed:', e);
  } finally {
    inflight.delete(key);
  }
}

// --- read side ----------------------------------------------------------
// A monotonic version per key, bumped on (re)capture, so consumers can
// re-fetch the blob URL when the preview changes (the URL itself is stable
// bytes; the version is the cache-busting signal).
const previewVersion = new Map<string, number>();
const listeners = new Set<() => void>();

export function previewVersionOf(key: string): number {
  return previewVersion.get(key) ?? 0;
}
function bumpPreviewVersion(key: string): void {
  previewVersion.set(key, (previewVersion.get(key) ?? 0) + 1);
  for (const l of listeners) l();
}
/** Subscribe to any preview (re)capture — consumers re-read on change. */
export function onPreviewChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface CacheVariant { variant: string; width: number; height: number; source_hash?: string | null }

/** Load the element's cached preview as an object URL, or null on a miss.
 *  Size-robust: discovers the stored `preview` size via list-variants rather
 *  than assuming the element's current size. Caller owns revoking the URL. */
export async function loadPreviewUrl(key: string): Promise<string | null> {
  try {
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId: key });
    const p = variants.find((v) => v.variant === 'preview');
    if (!p) return null;
    const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', {
      sourceId: key, variant: 'preview', width: p.width, height: p.height,
    });
    const bytes = new Uint8Array(buf);
    if (bytes.length === 0) return null;            // empty Response = miss
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  } catch (e) {
    console.warn('loadPreviewUrl failed:', e);
    return null;
  }
}

/** Load the element's cached preview as a base64 `data:` URL (or null on a
 *  miss). For embedding in exported HTML/PDF, where a blob: URL won't survive
 *  in the written file. */
export async function loadPreviewDataUrl(key: string): Promise<string | null> {
  try {
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId: key });
    const p = variants.find((v) => v.variant === 'preview');
    if (!p) return null;
    const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', {
      sourceId: key, variant: 'preview', width: p.width, height: p.height,
    });
    const bytes = new Uint8Array(buf);
    if (bytes.length === 0) return null;
    return `data:image/png;base64,${bytesToBase64(bytes)}`;
  } catch (e) {
    console.warn('loadPreviewDataUrl failed:', e);
    return null;
  }
}
