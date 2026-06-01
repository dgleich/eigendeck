// React hook: load an asset's bytes from SQLite, parse as .ipynb,
// and return the Notebook. Subscribes to `eigendeck:asset-changed`
// so file-watcher reloads re-parse and refresh the slide.
//
// Parallel pattern to useAssetUrl in src/lib/demoAssets.ts. The
// difference: we want the parsed JSON, not a blob URL, so we don't
// cache by URL.createObjectURL — just by parsed Notebook object.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseNotebookBytes } from './notebookParser';
import { Notebook } from './notebookFormat';

const cache = new Map<string, Notebook>();
const inflight = new Map<string, Promise<Notebook>>();

async function loadNotebook(assetId: string): Promise<Notebook> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  let p = inflight.get(assetId);
  if (!p) {
    p = (async () => {
      const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId });
      const nb = parseNotebookBytes(data);
      cache.set(assetId, nb);
      return nb;
    })().finally(() => inflight.delete(assetId));
    inflight.set(assetId, p);
  }
  return p;
}

export function invalidateNotebook(assetId: string) {
  cache.delete(assetId);
  inflight.delete(assetId);
}

export function useNotebook(assetId: string | undefined): {
  notebook: Notebook | null;
  error: Error | null;
  loading: boolean;
} {
  const [notebook, setNotebook] = useState<Notebook | null>(() =>
    assetId ? cache.get(assetId) ?? null : null
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) {
        invalidateNotebook(assetId);
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId]);

  useEffect(() => {
    if (!assetId) { setNotebook(null); setError(null); return; }
    let cancelled = false;
    setError(null);
    loadNotebook(assetId).then(
      (nb) => { if (!cancelled) setNotebook(nb); },
      (e: Error) => { if (!cancelled) setError(e); }
    );
    return () => { cancelled = true; };
  }, [assetId, refreshKey]);

  return { notebook, error, loading: notebook === null && error === null };
}
