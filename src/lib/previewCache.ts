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

/** Capture the element's rendered content to a PNG and store it as the cached
 *  preview. Captures `[data-element-id=el.id]`, or — when `innerSelector` is
 *  given — that descendant (e.g. '.nb-frame', so authoring chrome on the outer
 *  DraggableBox is excluded). No-op if not mounted / no size. Never throws. */
export async function capturePreview(
  el: SlideElement, innerSelector?: string,
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

  inflight.add(key);
  try {
    const { domToDataUrl } = await import('modern-screenshot');
    const dataUrl = await domToDataUrl(node, { width, height, scale: 1 });
    const bytes = dataUrlToBytes(dataUrl);
    await invoke('db_put_asset_cache', {
      sourceId: key,
      variant: 'preview',
      width,
      height,
      png: Array.from(bytes),
      sourceHash: null,
    });
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

interface CacheVariant { variant: string; width: number; height: number }

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
