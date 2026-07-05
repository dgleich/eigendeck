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

// NOTE: opaque-origin demos mount via demoMount.ts (its own marker gate +
// blob cache); the old same-origin demo-URL path that used to live here was
// removed with that migration (docs/DEMO-PLATFORM.md). This module now only
// serves image/video assets (useAssetUrl / getAssetUrl).

/** Invalidate a specific cached asset (e.g. after re-import). */
export function invalidateAsset(assetId: string) {
  const old = blobCache.get(assetId);
  if (old) {
    URL.revokeObjectURL(old);
    blobCache.delete(assetId);
  }
  mimeCache.delete(assetId);
}

/** Clean up all cached blob URLs (call on project close) */
export function clearAssetCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
  mimeCache.clear();
}

