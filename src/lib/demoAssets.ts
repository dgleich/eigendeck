/**
 * Manages blob URLs for demo HTML assets stored in SQLite.
 * Assets are loaded from db_get_asset and served as blob URLs
 * so iframes can render them without filesystem access.
 */

import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

// Cache: asset path -> blob URL (without hash)
const blobCache = new Map<string, string>();

/** Load a demo asset from SQLite and return a blob URL. Uses a cache. */
export async function getDemoUrl(assetPath: string, hash?: string): Promise<string | undefined> {
  // Check cache first
  let blobUrl = blobCache.get(assetPath);
  if (!blobUrl) {
    try {
      const data = await invoke<number[]>('db_get_asset', { path: assetPath });
      const blob = new Blob([new Uint8Array(data)], { type: 'text/html' });
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

/** React hook: load demo HTML from SQLite as a blob URL */
export function useDemoUrl(assetPath: string, hash?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    // Synchronous check: if already cached, use immediately
    const cached = blobCache.get(assetPath);
    return cached ? (hash ? `${cached}#${hash}` : cached) : undefined;
  });

  useEffect(() => {
    getDemoUrl(assetPath, hash).then(setUrl);
  }, [assetPath, hash]);

  return url;
}

/** Clean up all cached blob URLs (call on project close) */
export function clearDemoCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}
