// Tracks asset source files that have gone missing from disk (moved or
// deleted out from under a linked asset). Issue #74.
//
// Detection fires from three places, all of which already stat/read the
// source file:
//   • scanForChangedAssets()  — on project open (the common case: the file
//     moved while the deck was closed). UNGATED by the auto-reload toggle —
//     a missing source matters even if you're not auto-reloading it.
//   • WatcherRegistry.handleChange() — live, while the deck is open (covers
//     a delete/rename that the OS reports as a change event).
//   • AssetSection "Reload from disk now" — manual retry.
//
// IMPORTANT: a missing source never loses content. The last-loaded bytes stay
// in the assets table (the snapshot), so the slide keeps rendering. This module
// only SURFACES the situation (inspector banner + count) and powers Relocate.
//
// Observable three ways so any layer can react without a store dependency:
//   • subscribeMissing(cb) — low-level listener (set of missing asset ids)
//   • useAssetMissing(id) / useMissingCount() — React hooks
//   • window 'eigendeck:asset-missing' / 'eigendeck:asset-found' CustomEvents
//     (matches the existing 'eigendeck:asset-changed' convention)

import { useSyncExternalStore } from 'react';

export interface MissingAsset {
  assetId: string;
  /** Human-readable path label (the asset row's `path`, else external_path). */
  path: string;
}

// assetId -> path label
const missing = new Map<string, string>();

type Listener = (ids: ReadonlySet<string>) => void;
const listeners = new Set<Listener>();

function notify(): void {
  const ids = new Set(missing.keys());
  for (const l of listeners) l(ids);
}

function dispatch(name: string, detail: unknown): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/** Mark an asset's source file as missing. No-op if already marked the same. */
export function markAssetMissing(assetId: string, path: string): void {
  if (missing.get(assetId) === path) return;
  missing.set(assetId, path);
  notify();
  dispatch('eigendeck:asset-missing', { assetId, path });
}

/** Clear the missing flag — the source reappeared / was relocated. */
export function markAssetFound(assetId: string): void {
  if (!missing.has(assetId)) return;
  missing.delete(assetId);
  notify();
  dispatch('eigendeck:asset-found', { assetId });
}

export function isAssetMissing(assetId: string): boolean {
  return missing.has(assetId);
}

export function getMissingAssets(): MissingAsset[] {
  return Array.from(missing, ([assetId, path]) => ({ assetId, path }));
}

/** Drop all missing flags — called on project close so stale flags from a
 *  previous deck don't leak into the next one. */
export function clearAllMissing(): void {
  if (missing.size === 0) return;
  missing.clear();
  notify();
}

export function subscribeMissing(l: Listener): () => void {
  listeners.add(l);
  l(new Set(missing.keys()));
  return () => { listeners.delete(l); };
}

// --- React hooks (getSnapshot returns a primitive → stable, no extra renders).

export function useAssetMissing(assetId: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMissing(() => cb()),
    () => missing.has(assetId),
  );
}
