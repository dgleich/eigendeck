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

/** React hook: load an asset from SQLite as a blob URL */
export function useAssetUrl(assetPath: string | undefined, hash?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!assetPath) return undefined;
    const cached = blobCache.get(assetPath);
    return cached ? (hash ? `${cached}#${hash}` : cached) : undefined;
  });

  useEffect(() => {
    if (!assetPath) { setUrl(undefined); return; }
    getAssetUrl(assetPath, hash).then(setUrl);
  }, [assetPath, hash]);

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
