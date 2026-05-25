/**
 * Manages blob URLs for assets stored in SQLite.
 * Loads via db_get_asset_by_id when an assetId is known (unambiguous),
 * otherwise via db_get_asset by path label (legacy + fallback). Creates
 * blob URLs so iframes/images render without filesystem access.
 *
 * Cache key is `assetId ?? path`: when two distinct assets share a path
 * label, the assetId disambiguates them. Legacy elements without an
 * assetId still resolve via path; renderer behavior matches what it was
 * before assetId existed for those.
 */

import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

// Cache: `assetId ?? path` -> blob URL (without hash). Two consumers
// holding the same asset_id share one blob URL even if they got it by
// different paths or both lacked a path.
const blobCache = new Map<string, string>();

/** Guess MIME type from file extension */
function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

/** Load an asset from SQLite and return a blob URL. Uses a cache.
 *
 * Prefers `assetId` when set (unambiguous DB lookup); falls back to
 * `assetPath` (path-label lookup) for legacy elements without a binding.
 */
export async function getAssetUrl(assetPath: string, hash?: string, assetId?: string): Promise<string | undefined> {
  const key = assetId ?? assetPath;
  let blobUrl = blobCache.get(key);
  if (!blobUrl) {
    try {
      const data = assetId
        ? await invoke<number[]>('db_get_asset_by_id', { assetId })
        : await invoke<number[]>('db_get_asset', { path: assetPath });
      const blob = new Blob([new Uint8Array(data)], { type: mimeFromPath(assetPath) });
      blobUrl = URL.createObjectURL(blob);
      blobCache.set(key, blobUrl);
    } catch {
      // Fallback: try filesystem via convertFileSrc
      const projectPath = usePresentationStore.getState().projectPath;
      if (projectPath) {
        try {
          blobUrl = convertFileSrc(`${projectPath}/${assetPath}`);
        } catch { /* ignore */ }
      }
    }
  }
  if (!blobUrl) return undefined;
  return hash ? `${blobUrl}#${hash}` : blobUrl;
}

/** React hook: load an asset from SQLite as a blob URL.
 *
 * Listens for `eigendeck:asset-changed` (fired by invalidateRenderedAsset
 * after the file watcher reloads an asset) and matches on assetId when
 * set, falling back to path match for legacy elements. Drops the cached
 * blob URL on match and re-fetches so the live `<img>` picks up new
 * bytes.
 */
export function useAssetUrl(assetPath: string | undefined, hash?: string, assetId?: string): string | undefined {
  const cacheKey = assetId ?? assetPath;
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!cacheKey) return undefined;
    const cached = blobCache.get(cacheKey);
    return cached ? (hash ? `${cached}#${hash}` : cached) : undefined;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetPath && !assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; assetId?: string } | undefined;
      // Prefer assetId match; fall back to path match for backwards-compat events.
      const matches = assetId && detail?.assetId
        ? detail.assetId === assetId
        : detail?.path === assetPath;
      if (matches) {
        invalidateAsset(assetPath ?? '', assetId);
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetPath, assetId]);

  useEffect(() => {
    if (!assetPath) { setUrl(undefined); return; }
    getAssetUrl(assetPath, hash, assetId).then(setUrl);
  }, [assetPath, hash, assetId, refreshKey]);

  return url;
}

// Convenience aliases
export const useDemoUrl = useAssetUrl;
export const getDemoUrl = getAssetUrl;

/** Invalidate a specific cached asset (e.g. after re-import).
 *  Invalidates by both assetId and path keys so listeners using either
 *  resolution path see the change. */
export function invalidateAsset(assetPath: string, assetId?: string) {
  for (const key of [assetId, assetPath]) {
    if (!key) continue;
    const old = blobCache.get(key);
    if (old) {
      URL.revokeObjectURL(old);
      blobCache.delete(key);
    }
  }
}

/** Clean up all cached blob URLs (call on project close) */
export function clearAssetCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}
