/**
 * Manages blob URLs for assets stored in SQLite. Everything is keyed by
 * `assetId` — the element type carries the binding, the renderer hooks
 * resolve bytes via `db_get_asset_by_id`. No path-fallback lookup.
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Cache: assetId -> blob URL (without hash).
const blobCache = new Map<string, string>();
// Cache: assetId -> MIME type, learned from db_get_asset_meta_by_id on
// first fetch. Used so blob URLs have the right `type` and the browser
// dispatches the right rendering pipeline.
const mimeCache = new Map<string, string>();

async function fetchMime(assetId: string): Promise<string> {
  const cached = mimeCache.get(assetId);
  if (cached) return cached;
  try {
    const meta = await invoke<{ mime_type: string | null } | null>(
      'db_get_asset_meta_by_id', { assetId },
    );
    const mime = meta?.mime_type || 'application/octet-stream';
    mimeCache.set(assetId, mime);
    return mime;
  } catch {
    return 'application/octet-stream';
  }
}

/** Load an asset from SQLite and return a blob URL. Uses a cache. */
export async function getAssetUrl(
  assetId: string | undefined,
  hash?: string,
): Promise<string | undefined> {
  if (!assetId) return undefined;
  let blobUrl = blobCache.get(assetId);
  if (!blobUrl) {
    try {
      const [data, mime] = await Promise.all([
        invoke<ArrayBuffer>('db_get_asset_by_id', { assetId }),
        fetchMime(assetId),
      ]);
      const blob = new Blob([new Uint8Array(data)], { type: mime });
      blobUrl = URL.createObjectURL(blob);
      blobCache.set(assetId, blobUrl);
    } catch {
      return undefined;
    }
  }
  return hash ? `${blobUrl}#${hash}` : blobUrl;
}

/** React hook: load an asset from SQLite as a blob URL.
 *
 * Listens for `eigendeck:asset-changed` (fired by invalidateRenderedAsset
 * after the file watcher reloads an asset). Drops the cached blob URL
 * on assetId match and re-fetches so the live `<img>` picks up new bytes.
 */
export function useAssetUrl(
  assetId: string | undefined,
  hash?: string,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!assetId) return undefined;
    const cached = blobCache.get(assetId);
    return cached ? (hash ? `${cached}#${hash}` : cached) : undefined;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) {
        invalidateAsset(assetId);
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId]);

  useEffect(() => {
    if (!assetId) { setUrl(undefined); return; }
    getAssetUrl(assetId, hash).then(setUrl);
  }, [assetId, hash, refreshKey]);

  return url;
}

// assetIds whose bytes were checked and are NOT a marked eigendeck demo → don't mount.
const demoBlockedCache = new Set<string>();

/**
 * Demo-mount gate (docs/ASSETS-SECURITY.md — "demo-ingestion invariant"): re-check the
 * eigendeck-demo marker on the bytes BEFORE creating the iframe URL, so a deck can never
 * RENDER non-demo HTML as a demo even if such bytes got in outside the add/watch gates
 * (CLI import, hand-edited DB, a pre-marker legacy demo). Returns the blob URL, or null
 * if the bytes aren't a marked demo (the caller shows a "not a valid demo" notice).
 */
async function getDemoUrl(assetId: string | undefined, hash?: string): Promise<string | null> {
  if (!assetId) return null;
  if (demoBlockedCache.has(assetId)) return null;
  let blobUrl = blobCache.get(assetId);
  if (!blobUrl) {
    try {
      const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId });
      const bytes = new Uint8Array(data);
      const { isEigendeckDemo } = await import('./assetTypes.mjs');
      if (!isEigendeckDemo(bytes).ok) { demoBlockedCache.add(assetId); return null; }
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/html' }));
      blobCache.set(assetId, blobUrl);
    } catch {
      return null;
    }
  }
  return hash ? `${blobUrl}#${hash}` : blobUrl;
}

/** React hook for a demo iframe source. Like useAssetUrl, but validates the demo marker
 *  first (see getDemoUrl). Returns a blob URL, `undefined` while loading, or `null` when
 *  the bytes are blocked (not a marked eigendeck demo). */
export function useDemoUrl(assetId: string | undefined, hash?: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) {
        invalidateAsset(assetId);
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId]);

  useEffect(() => {
    if (!assetId) { setUrl(undefined); return; }
    let alive = true;
    getDemoUrl(assetId, hash).then((r) => { if (alive) setUrl(r); });
    return () => { alive = false; };
  }, [assetId, hash, refreshKey]);

  return url;
}

/** Invalidate a specific cached asset (e.g. after re-import). */
export function invalidateAsset(assetId: string) {
  const old = blobCache.get(assetId);
  if (old) {
    URL.revokeObjectURL(old);
    blobCache.delete(assetId);
  }
  mimeCache.delete(assetId);
  demoBlockedCache.delete(assetId); // re-validate the marker on next mount
}

/** Clean up all cached blob URLs (call on project close) */
export function clearAssetCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
  mimeCache.clear();
}

