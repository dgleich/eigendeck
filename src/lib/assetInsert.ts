// Wraps db_store_asset with path-collision detection. Used by
// drag-drop and file-picker insertion paths. Clipboard paste skips
// this helper (paste paths are synthetic — collisions ~never the
// user's intent).
//
// See docs/ASSETS.md → "Path collision dialog" for the full design.

import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { showCollisionDialog } from './collisionDialog';

interface StoreArgs {
  path: string;
  data: Uint8Array;
  mimeType: string;
  externalPath: string | null;
  externalMtime: string | null;
}

interface StoreResult {
  /** Asset id under which the bytes are stored. Caller puts this on the
   *  new element so future renders bind unambiguously. */
  assetId: string;
  /** Path label that ended up being stored. ALWAYS equals the input
   *  `path` today (no path mutation on collision); kept as a field so a
   *  future "Import as new and rename" option can plug in cleanly. */
  path: string;
  /** True when the user cancelled the dialog. Caller should NOT add an
   *  element to the slide in that case. */
  cancelled: boolean;
}

interface AssetMeta {
  asset_id: string;
  path: string | null;
  external_path: string | null;
  external_mtime: string | null;
  mime_type: string | null;
  auto_reload: string | null;
  hash: string | null;
}

/**
 * Store an asset, prompting on path collision when the new bytes differ
 * from the existing asset's bytes. Returns the chosen asset_id (and
 * `cancelled: true` if the user backed out).
 *
 * Behavior:
 *   - No existing asset at that path     → db_store_asset, fresh assetId
 *   - Existing asset, same hash          → db_store_asset (it dedups
 *                                          internally), reuses existing
 *                                          assetId, no dialog
 *   - Existing asset, different hash     → dialog → user choice
 *
 * Caller should treat `cancelled: true` as "do nothing; the user
 * decided not to insert."
 */
export async function storeAssetWithCollisionCheck(args: StoreArgs): Promise<StoreResult> {
  const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_path', { path: args.path })
    .catch(() => null);

  if (!meta) {
    // No collision — straight insert.
    const assetId = await invoke<string>('db_store_asset', toStoreArgs(args));
    return { assetId, path: args.path, cancelled: false };
  }

  // Existing asset at this path: hash-compare before bothering the user.
  const newHash = await sha256Hex(args.data);
  if (meta.hash && meta.hash === newHash) {
    // Same bytes — db_store_asset will silently dedup. No dialog.
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    return { assetId, path: args.path, cancelled: false };
  }

  // Different bytes — ask the user. Count usages first so the dialog
  // can show "used on N elements across M slides".
  const { usageCount, slideCount } = countAssetUsage(meta.asset_id, args.path);
  const choice = await showCollisionDialog({
    path: args.path,
    existingExternalPath: meta.external_path,
    usageCount,
    slideCount,
  });

  if (choice === 'cancel') {
    return { assetId: '', path: args.path, cancelled: true };
  }

  if (choice === 'update') {
    // Reuse existing asset_id; bytes become new version. Other elements
    // bound to this asset_id also reflect the new bytes.
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    return { assetId, path: args.path, cancelled: false };
  }

  // choice === 'new': fresh asset_id, same path label. Older elements
  // stay bound to meta.asset_id and render their original bytes.
  const assetId = await invoke<string>('db_store_asset', toStoreArgs(args));
  return { assetId, path: args.path, cancelled: false };
}

function toStoreArgs(a: StoreArgs): Record<string, unknown> {
  return {
    path: a.path,
    data: Array.from(a.data),
    mimeType: a.mimeType,
    externalPath: a.externalPath,
    externalMtime: a.externalMtime,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto needs an ArrayBuffer view; bytes.buffer may be a
  // SharedArrayBuffer-ish thing in some envs, so slice into a clean one.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Count how many elements in the current presentation are bound to a
 * given asset_id (preferred) or path label (fallback for legacy
 * elements without assetId). Returns the element count and the distinct
 * slide count.
 */
function countAssetUsage(assetId: string, path: string): { usageCount: number; slideCount: number } {
  const pres = usePresentationStore.getState().presentation;
  if (!pres) return { usageCount: 0, slideCount: 0 };
  let usageCount = 0;
  const slidesUsing = new Set<string>();
  for (const slide of pres.slides) {
    let hit = false;
    for (const el of slide.elements) {
      if (el.type !== 'image' && el.type !== 'demo' && el.type !== 'demo-piece') continue;
      const e = el as { assetId?: string; src?: string; demoSrc?: string };
      const elPath = e.demoSrc ?? e.src;
      // Bound by assetId if both have one; else fall back to path label
      // (catches legacy elements before backfill ran).
      const bound = e.assetId ? e.assetId === assetId : elPath === path;
      if (bound) {
        usageCount++;
        hit = true;
      }
    }
    if (hit) slidesUsing.add(slide.id);
  }
  return { usageCount, slideCount: slidesUsing.size };
}
