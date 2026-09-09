/**
 * Thin invoke() wrappers for the two maintenance commands App.tsx calls
 * (Compact and GC assets). All other deck state goes through the Zustand
 * store in ./presentation.ts; the SQLite facade that used to live here was
 * never wired in and was removed on 2026-09-09.
 */

import { invoke } from '@tauri-apps/api/core';

export async function dbCompact(deleteAll: boolean = false): Promise<{ beforeBytes: number; afterBytes: number; savedBytes: number }> {
  const json = await invoke<string>('db_compact', { keepAll: deleteAll });
  return JSON.parse(json);
}

/** Free unused asset bytes: drop every assets row (current + history)
 *  whose asset_id is not referenced by any current element, cascade
 *  asset_cache, VACUUM. Manual-only — no automatic trigger. */
export async function dbGcAssets(): Promise<{
  removedAssets: number;
  removedVersions: number;
  removedCacheRows: number;
  beforeBytes: number;
  afterBytes: number;
  bytesFreed: number;
}> {
  const json = await invoke<string>('db_gc_assets');
  return JSON.parse(json);
}
