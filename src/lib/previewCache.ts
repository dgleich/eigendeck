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
import { hashString } from './hash';

/** The cache key for an element's preview: its sync identity. */
// Separator between the readable theme-salt prefix and the content hash in a
// DOM-node preview's stored signature. A control char that can't appear in a
// theme salt (hex colors + `|`) or a base-36 hash, so a plain split is safe.
const PREVIEW_SALT_SEP = '␞';

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

/** Dedup + persist a capture: skip if the size/theme signature is unchanged
 *  (in-memory + persisted), else run `produce` for the PNG data URL and store it.
 *  Shared by the demo-iframe path (bridge round-trip) and the in-DOM path
 *  (modern-screenshot) — they differ only in the signature and the producer. */
async function storeCapture(
  key: string, width: number, height: number, sig: string,
  produce: () => Promise<string | null | undefined>,
): Promise<void> {
  if (lastHash.get(key) === sig) return;
  try {
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId: key });
    const ex = variants.find((v) => v.variant === 'preview' && v.width === width && v.height === height);
    if (ex && ex.source_hash === sig) { lastHash.set(key, sig); return; }  // persisted + unchanged
  } catch { /* fall through and (re)capture */ }
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    const dataUrl = await produce();
    if (!dataUrl) return;
    const bytes = dataUrlToBytes(dataUrl);
    await invoke('db_put_asset_cache', { sourceId: key, variant: 'preview', width, height, png: Array.from(bytes), sourceHash: sig });
    lastHash.set(key, sig);
    bumpPreviewVersion(key);
  } catch (e) {
    console.warn('capturePreview failed:', e);
  } finally {
    inflight.delete(key);
  }
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
  const width = Math.round(el.position.width);
  const height = Math.round(el.position.height);
  if (!width || !height) return;

  // A demo renders in an OPAQUE-ORIGIN iframe (docs/DEMO-PLATFORM.md §8): the
  // parent can't reach its DOM, so ask the in-demo bridge to rasterize itself and
  // post the PNG back. Dedup by size + theme salt (the content HTML is unreadable).
  if (node instanceof HTMLIFrameElement) {
    const iframe = node;
    const sig = hashString(`${width}x${height}|${cacheSalt ?? ''}|${backgroundColor ?? ''}`);
    await storeCapture(key, width, height, sig, async () => {
      const { requestDemoCapture } = await import('./demoMount');
      return requestDemoCapture(iframe, { width, height, backgroundColor });
    });
    return;
  }

  // In-DOM node (notebook / video): rasterize directly. The signature includes the
  // node's HTML so it changes exactly when the picture's structure does. (Canvas
  // pixel state isn't in the HTML — acceptable: a thumbnail is a single frame.)
  // The theme salt is kept as a READABLE prefix (not folded into the hash) so the
  // PDF/print export can compare it against the current theme WITHOUT the node's
  // outerHTML — which it can't read for a notebook that isn't on the current slide.
  // A theme change then reads stale at export → forces a fresh capture (#140).
  const sig = `${cacheSalt ?? ''}${PREVIEW_SALT_SEP}${hashString(`${width}x${height}|${backgroundColor ?? ''}|${node.outerHTML}`)}`;
  await storeCapture(key, width, height, sig, async () => {
    const { domToDataUrl } = await import('modern-screenshot');
    return domToDataUrl(node, { width, height, scale: 1, backgroundColor });
  });
}

// --- read side ----------------------------------------------------------
// A monotonic version per key, bumped on (re)capture, so consumers can
// re-fetch the blob URL when the preview changes (the URL itself is stable
// bytes; the version is the cache-busting signal).
const previewVersion = new Map<string, number>();
const listeners = new Set<() => void>();

function bumpPreviewVersion(key: string): void {
  previewVersion.set(key, (previewVersion.get(key) ?? 0) + 1);
  for (const l of listeners) l();
}
/** Subscribe to any preview (re)capture — consumers re-read on change. */
export function onPreviewChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Drop a preview: forget the session hash AND delete the persisted cache row,
 *  so the next capturePreview re-renders it even if the content is unchanged.
 *  Used by "Refresh All Snapshots" to force a full re-render. Best-effort. */
export async function clearPreview(key: string): Promise<void> {
  lastHash.delete(key);
  try { await invoke('db_clear_asset_cache', { sourceId: key }); }
  catch (e) { console.warn('clearPreview failed:', e); }
  bumpPreviewVersion(key);
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

/** True when a cached DOM-node (notebook) preview exists but was captured under a
 *  DIFFERENT theme salt than `expectedSalt` — so the PDF/print export should
 *  re-capture it instead of baking the stale-theme PNG (#140). False when there's
 *  no cached preview, or its stored signature predates the salt-prefix format
 *  (can't tell → treat as fresh, preserving prior behavior). */
export async function isPreviewThemeStale(key: string, expectedSalt: string): Promise<boolean> {
  try {
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId: key });
    const p = variants.find((v) => v.variant === 'preview');
    if (!p || !p.source_hash) return false;
    const i = p.source_hash.indexOf(PREVIEW_SALT_SEP);
    if (i < 0) return false; // pre-prefix format — can't compare, keep the cached preview
    return p.source_hash.slice(0, i) !== expectedSalt;
  } catch {
    return false;
  }
}
