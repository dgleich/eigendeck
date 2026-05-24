/**
 * Manages blob URLs for assets stored in SQLite.
 * Loads via db_get_asset and creates blob URLs so iframes/images
 * can render without filesystem access.
 */

import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

// Cache: asset path -> blob URL (without hash)
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

/** Load an asset from SQLite and return a blob URL. Uses a cache. */
export async function getAssetUrl(assetPath: string, hash?: string): Promise<string | undefined> {
  let blobUrl = blobCache.get(assetPath);
  if (!blobUrl) {
    try {
      const data = await invoke<number[]>('db_get_asset', { path: assetPath });
      const blob = new Blob([new Uint8Array(data)], { type: mimeFromPath(assetPath) });
      blobUrl = URL.createObjectURL(blob);
      blobCache.set(assetPath, blobUrl);
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
 * after the file watcher reloads an asset) and, when the changed path
 * matches, drops the cached blob URL and re-fetches so the live `<img>`
 * picks up the new bytes. Same mechanism `useRenderedAsset` already
 * uses — without this, the editor canvas keeps the stale blob URL
 * forever even though the bytes in SQLite were updated. */
export function useAssetUrl(assetPath: string | undefined, hash?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!assetPath) return undefined;
    const cached = blobCache.get(assetPath);
    return cached ? (hash ? `${cached}#${hash}` : cached) : undefined;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetPath) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path === assetPath) {
        invalidateAsset(assetPath);
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetPath]);

  useEffect(() => {
    if (!assetPath) { setUrl(undefined); return; }
    getAssetUrl(assetPath, hash).then(setUrl);
  }, [assetPath, hash, refreshKey]);

  return url;
}

// Convenience aliases
export const useDemoUrl = useAssetUrl;
export const getDemoUrl = getAssetUrl;

/** Invalidate a specific cached asset (e.g. after re-import) */
export function invalidateAsset(assetPath: string) {
  const old = blobCache.get(assetPath);
  if (old) {
    URL.revokeObjectURL(old);
    blobCache.delete(assetPath);
  }
}

/** Clean up all cached blob URLs (call on project close) */
export function clearAssetCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}
