// Wraps db_store_asset with "asset has silently changed since first
// add" detection. Used by drag-drop and file-picker insertion paths.
// Clipboard paste skips this helper — paste creates synthetic
// `pasted-<ts>.svg` paths, so this scenario never applies.
//
// See docs/ASSETS.md → "Path collision dialog" for the full design.

import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { getSlideNumber } from '../types/presentation';
import { invalidateRenderedAsset } from './assetRenderer';
import { showCollisionDialog } from './collisionDialog';

// Verbose log of insertion + collision-check decisions. Visible in the
// in-app Debug Console (View menu). Toggle off when no longer useful.
const INSERT_LOG = true;
const ilog = (...a: unknown[]): void => {
  if (INSERT_LOG) console.log(`[insert ${new Date().toISOString().slice(11, 23)}]`, ...a);
};

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
  /** Path label the new element should reference. Always equals the
   *  input `path` today (no path mutation). */
  path: string;
  /** True when the user cancelled the dialog (Esc / clicked outside).
   *  Caller should NOT add an element to the slide in that case. */
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

interface AssetVersion {
  asset_id: string;
  valid_from: string;
  valid_to: string | null;
  size: number;
  hash: string | null;
  mime_type: string | null;
  external_mtime: string | null;
}

/**
 * Store an asset, prompting only when there's a silent-change surprise
 * to surface. Three paths:
 *
 *   No existing asset at this path
 *     → db_store_asset, return fresh assetId.
 *
 *   Existing asset present, its current bytes match its ORIGINAL bytes
 *   (no silent change has ever happened)
 *     → db_store_asset reusing existing assetId, no dialog. The new
 *       bytes either equal current (dedup no-op) or genuinely update
 *       the asset (rare — file diverged without the watcher running).
 *
 *   Existing asset present, current bytes differ from its original
 *   bytes (file has been silently auto-reloaded since first add)
 *     → dialog. User opts into one of two intents (see CollisionDialog).
 *
 * Orphan assets (path exists in `assets` but no element references the
 * asset_id) skip the dialog — the surprise doesn't apply when nothing
 * was using the prior version.
 */
export async function storeAssetWithCollisionCheck(args: StoreArgs): Promise<StoreResult> {
  const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_path', { path: args.path })
    .catch(() => null);

  if (!meta) {
    // No existing asset at this path → simple insertion.
    const assetId = await invoke<string>('db_store_asset', toStoreArgs(args));
    ilog(`new asset at "${args.path}" → ${assetId.slice(0, 8)}`);
    return { assetId, path: args.path, cancelled: false };
  }
  ilog(`existing asset at "${args.path}" → asset_id=${meta.asset_id.slice(0, 8)} current_hash=${meta.hash?.slice(0, 8)}`);

  // Fetch history to find the ORIGINAL bytes (oldest version). If
  // current hash matches original hash, no silent change has occurred —
  // store as a new version of the existing asset (will dedup if bytes
  // match, otherwise updates explicitly).
  const history = await invoke<AssetVersion[]>('db_get_asset_history', { assetId: meta.asset_id })
    .catch(() => [] as AssetVersion[]);
  const original = history[history.length - 1];

  if (!original || !original.hash || !meta.hash || original.hash === meta.hash) {
    // No history / matching hashes → no silent change. Just store.
    ilog(`no silent change (original_hash=${original?.hash?.slice(0, 8) ?? 'n/a'} == current_hash=${meta.hash?.slice(0, 8) ?? 'n/a'}) → silent store on existing asset`);
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    return { assetId, path: args.path, cancelled: false };
  }
  ilog(`SILENT CHANGE detected: original_hash=${original.hash.slice(0, 8)} != current_hash=${meta.hash.slice(0, 8)} (history: ${history.length} versions)`);

  // Silent change detected. Find which slides currently use this asset.
  const slidesUsing = findSlidesUsingAsset(meta.asset_id, args.path);
  ilog(`asset used on slides: ${slidesUsing.length === 0 ? '(none — orphan)' : slidesUsing.join(', ')}`);
  if (slidesUsing.length === 0) {
    // Orphan: asset has versions but no element references it. No
    // surprise to surface. Just store as a new version (effectively
    // resurrects + updates).
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    return { assetId, path: args.path, cancelled: false };
  }

  ilog(`showing collision dialog`);
  const choice = await showCollisionDialog({
    path: args.path,
    slideNumbers: slidesUsing,
  });
  ilog(`user chose: ${choice}`);

  if (choice === 'cancel') {
    return { assetId: '', path: args.path, cancelled: true };
  }

  if (choice === 'accept') {
    // User opted into the auto-updating behavior. Store new bytes
    // (will dedup if they match the silently-updated current bytes).
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    ilog(`accept: stored on existing asset_id=${meta.asset_id.slice(0, 8)}`);
    return { assetId, path: args.path, cancelled: false };
  }

  // choice === 'revert': three-step flow.
  //   1. Restore the existing asset to its original bytes (db_restore_
  //      asset_version sets auto_reload='off' on the restored row so
  //      the watcher won't immediately re-apply the change).
  //   2. Create a NEW asset (FRESH asset_id, same path label) with the
  //      bytes the user just dragged in.
  //   3. Disable auto-reload for the entire presentation per the user's
  //      explicit opt-out in the dialog wording.
  //
  // CRITICAL: step 2 generates the UUID on the JS side and passes it
  // explicitly. Without an explicit assetId, db_store_asset's legacy
  // "look up asset_id by path" branch would re-find the asset we just
  // restored (same path), reuse its asset_id, and silently overwrite
  // the restore with the new bytes — defeating the whole revert flow.
  // The explicit UUID forces db_store_asset's "use this asset_id"
  // branch, which is the only way to guarantee a fresh asset at a
  // path that's already in use.
  ilog(`revert: restoring asset_id=${meta.asset_id.slice(0, 8)} to original valid_from=${original.valid_from}`);
  await invoke('db_restore_asset_version', {
    assetId: meta.asset_id,
    validFrom: original.valid_from,
  }).catch((e) => { console.warn('[insert] revert failed:', e); });
  await invalidateRenderedAsset(args.path, meta.asset_id);

  const newAssetId = crypto.randomUUID();
  ilog(`revert: creating NEW asset_id=${newAssetId.slice(0, 8)} at path="${args.path}" with new bytes`);
  await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: newAssetId });
  usePresentationStore.getState().updateConfig({ autoReloadAssets: 'off' });
  ilog(`revert: per-presentation auto-reload set to OFF`);

  return { assetId: newAssetId, path: args.path, cancelled: false };
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

/**
 * 1-based slide numbers (per getSlideNumber) of every slide that
 * currently contains an element bound to the given asset_id, OR (for
 * legacy elements lacking an assetId binding) an element whose
 * src/demoSrc equals the path label. Sorted ascending.
 */
function findSlidesUsingAsset(assetId: string, path: string): number[] {
  const pres = usePresentationStore.getState().presentation;
  if (!pres) return [];
  const out: number[] = [];
  pres.slides.forEach((slide, idx) => {
    for (const el of slide.elements) {
      if (el.type !== 'image' && el.type !== 'demo' && el.type !== 'demo-piece') continue;
      const e = el as { assetId?: string; src?: string; demoSrc?: string };
      const elPath = e.demoSrc ?? e.src;
      const bound = e.assetId ? e.assetId === assetId : elPath === path;
      if (bound) {
        out.push(getSlideNumber(pres.slides, idx));
        return; // one entry per slide is enough
      }
    }
  });
  return out;
}
