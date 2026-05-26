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
 * Store an asset, prompting only when the bytes being added DIFFER
 * from what the user originally added at this path.
 *
 *   No existing asset at this path
 *     → db_store_asset, return fresh assetId. No dialog.
 *
 *   Existing asset, new bytes match the existing asset's ORIGINAL
 *   bytes (oldest version's hash). User is re-adding the same file
 *   they first added; no surprise to surface.
 *     → db_store_asset reusing existing assetId, no dialog. Internal
 *       hash dedup keeps it a no-op when current also equals original.
 *
 *   Existing asset, new bytes differ from the existing asset's
 *   original bytes. User is putting different content at a path
 *   they already used — whether the divergence came from a silent
 *   watcher update, an external edit with auto-reload off, or a
 *   user-initiated change.
 *     → dialog. User opts into one of two intents (see CollisionDialog).
 *
 * Orphan assets (path exists but no element references the asset_id)
 * skip the dialog.
 *
 * All "store on existing assetId" paths invalidate the asset cache
 * afterward — other slides bound to the same assetId have stale blob
 * URLs / cached PNGs from the prior bytes; without invalidation they
 * keep showing the old content until next reload.
 */
export async function storeAssetWithCollisionCheck(args: StoreArgs): Promise<StoreResult> {
  // PowerPoint mode: when per-presentation auto-reload is OFF (set
  // explicitly by the user, or carried over from a prior "I don't want
  // this behavior" choice in the collision dialog), every insertion is
  // independent. No shared asset_id with prior inserts at the same
  // path, no external_path link (so watching can never resume even if
  // the user flips per-pres back to ON — re-import to relink), no
  // collision dialog. This is the kindness for users who explicitly
  // opted out of the auto-update paradigm.
  const presOverride = usePresentationStore.getState().presentation?.config?.autoReloadAssets ?? null;
  if (presOverride === 'off') {
    const assetId = crypto.randomUUID();
    // external_path IS preserved: the manual "Reload from disk now"
    // button in the Asset properties section is a useful affordance
    // even in PowerPoint mode. The cascade still blocks the watcher
    // from subscribing (per-pres OFF wins over null per-asset), so
    // there's no auto-update — but the user can explicitly pull a
    // fresh version from disk via Reload-now whenever they want.
    await invoke('db_store_asset', { ...toStoreArgs(args), assetId });
    ilog(`per-pres auto-reload OFF: fresh independent asset ${assetId.slice(0, 8)} at "${args.path}" (link preserved for manual Reload-now, watcher blocked by cascade)`);
    return { assetId, path: args.path, cancelled: false };
  }

  const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_path', { path: args.path })
    .catch(() => null);

  if (!meta) {
    // No existing asset at this path → simple insertion.
    const assetId = await invoke<string>('db_store_asset', toStoreArgs(args));
    ilog(`new asset at "${args.path}" → ${assetId.slice(0, 8)}`);
    return { assetId, path: args.path, cancelled: false };
  }
  ilog(`existing asset at "${args.path}" → asset_id=${meta.asset_id.slice(0, 8)} current_hash=${meta.hash?.slice(0, 8)}`);

  // Compare the bytes being added against the existing asset's ORIGINAL
  // bytes (oldest version's hash). Match → user is re-adding what they
  // originally added; no surprise. Mismatch → divergence (silent watch
  // update, or external edit with auto-reload off, or just a different
  // file) → dialog.
  const history = await invoke<AssetVersion[]>('db_get_asset_history', { assetId: meta.asset_id })
    .catch(() => [] as AssetVersion[]);
  const original = history[history.length - 1];
  const newHash = await sha256Hex(args.data);

  if (!original || !original.hash || original.hash === newHash) {
    // No history / new bytes match original → no surprise. Store on
    // existing assetId (will dedup if current also matches original;
    // otherwise effectively reverts current to original).
    ilog(`new bytes match original (original_hash=${original?.hash?.slice(0, 8) ?? 'n/a'} == new_hash=${newHash.slice(0, 8)}) → silent store on existing asset`);
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    await invalidateRenderedAsset(args.path, meta.asset_id);
    return { assetId, path: args.path, cancelled: false };
  }
  ilog(`DIVERGENCE detected: original_hash=${original.hash.slice(0, 8)} != new_hash=${newHash.slice(0, 8)} (current=${meta.hash?.slice(0, 8)}, history: ${history.length} versions)`);

  const slidesUsing = findSlidesUsingAsset(meta.asset_id, args.path);
  ilog(`asset used on slides: ${slidesUsing.length === 0 ? '(none — orphan)' : slidesUsing.join(', ')}`);
  if (slidesUsing.length === 0) {
    // Orphan: asset has versions but no element references it. No
    // surprise to surface. Store a new version of the orphan.
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    await invalidateRenderedAsset(args.path, meta.asset_id);
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
    // User opted into the auto-updating behavior. Store new bytes on
    // the existing assetId; all elements bound to it see the new bytes.
    // Cache invalidation is critical: other slides' main-window <img>
    // blob URLs cached the OLD bytes via useAssetUrl; without
    // invalidation they keep showing stale until next reload.
    const assetId = await invoke<string>('db_store_asset', { ...toStoreArgs(args), assetId: meta.asset_id });
    await invalidateRenderedAsset(args.path, meta.asset_id);
    ilog(`accept: stored on existing asset_id=${meta.asset_id.slice(0, 8)} + invalidated cache`);
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
  ilog(`revert: creating NEW asset_id=${newAssetId.slice(0, 8)} at path="${args.path}" with new bytes (link preserved)`);
  // external_path IS preserved (same rationale as PowerPoint mode):
  // Reload-now is a useful manual affordance. Cascade blocks watcher.
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
