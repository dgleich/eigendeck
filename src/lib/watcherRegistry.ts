// Per-project file-watcher registry.
//
// Keyed by `project_id` (the stable UUID in _meta), NOT by project path
// — projectPath can change underneath us (macOS in-place rename keeps
// the file handle alive but mutates the filename; Save As writes to a
// new path). Keying on the stable id means the registry survives
// renames cleanly; only Save As (which generates a fresh project_id)
// gets a fresh registry.
//
// Within a registry: one `fs.watch` per external_path even if multiple
// assets reference it (e.g. two ImageElements both pointing at the
// same source SVG). The Set fan-out means a single disk event causes
// db_store_asset for each subscribed asset_id; hash dedup at the
// storage layer makes redundant writes silent.
//
// Lifecycle:
//   - getWatcherRegistry(projectId) -> get-or-create
//   - addRef / removeRef from useAssetFileWatcher mount/cleanup
//   - closeWatcherRegistry(projectId) on project switch or window close

import { invoke } from '@tauri-apps/api/core';
import { sha256Hex } from './hash';
import { invalidateRenderedAsset } from './assetRenderer';
import { effectiveAutoReload, getPreference } from './preferences';
import { markAssetMissing, markAssetFound, isAssetMissing } from './missingAssets';

// Verbose logging surfaces in the in-app Debug Console (View menu)
// because console.log is intercepted there. Prefix `[watcher]` so the
// user can filter or scroll for them. Off by default — flip true to
// debug watcher subscribe/unsubscribe/event-dispatch decisions.
const WATCHER_LOG = false;
const wlog = (...a: unknown[]): void => {
  if (WATCHER_LOG) console.log(`[watcher ${new Date().toISOString().slice(11, 23)}]`, ...a);
};

/** Result of the asset-security read gate. `gated` = deliberately blocked (skip
 *  silently, snapshot stays); `unreadable` = the file is gone/erred (caller may
 *  flag the asset missing per #74); `ok` carries the safe resolved bytes. */
export type GatedRead =
  | { status: 'ok'; bytes: Uint8Array }
  | { status: 'gated' }
  | { status: 'unreadable' };

/**
 * The asset-security read gate for external files (docs/ASSETS-SECURITY.md).
 * Every disk read of a watched/linked asset goes through this. It:
 *  - reads the CURRENTLY-OPEN deck's token from the store; no token → 'gated';
 *  - requires the deck to be TRUSTED (a received/untrusted deck performs ZERO disk
 *    reads → 'gated', the embedded snapshot stays);
 *  - resolves via resolveAndGate so realpath + the asset-type allowlist apply even
 *    to trusted decks (a symlink to a non-asset / wrong-type file → 'gated'), and a
 *    genuinely missing/erroring file → 'unreadable'.
 * Never throws. Dynamic imports avoid a static cycle with the store.
 */
export async function gatedExternalRead(absPath: string): Promise<GatedRead> {
  try {
    const { usePresentationStore } = await import('../store/presentation');
    const token = usePresentationStore.getState().presentation?.config?.deckToken;
    if (!token) return { status: 'gated' };
    const { isTrusted, isPathApproved } = await import('./trustStore');
    if (!(await isTrusted(token))) return { status: 'gated' };
    const { resolveAndGate } = await import('./assetGate');
    const gate = await resolveAndGate(absPath);
    if (!(gate.ok && gate.bytes && gate.canonicalPath)) {
      return { status: gate.reason === 'unreadable' ? 'unreadable' : 'gated' };
    }
    // Per-path approval: a trusted deck reads only paths approved in the ledger
    // (keyed by the RESOLVED target). Unapproved → gated (snapshot stays) until the
    // user approves it in the Security panel. See docs/ASSETS-SECURITY.md.
    if (!(await isPathApproved(token, gate.canonicalPath))) return { status: 'gated' };
    return { status: 'ok', bytes: gate.bytes };
  } catch {
    return { status: 'unreadable' };
  }
}

interface SubscribedAsset {
  /** Real stable asset_id from the assets table — what db_store_asset
   *  needs to version the right row (NOT a path-derived placeholder). */
  assetId: string;
  /** Original path label stored on the asset row (e.g. "images/foo.svg") —
   *  preserved so re-stores keep the same path metadata. */
  path: string;
  /** Element ids currently subscribed to this asset. Multiple elements
   *  may be bound to the same asset_id (e.g. user drags the same image
   *  onto 3 slides). Tracking per-element lets removeRef be ref-counted:
   *  the asset entry is dropped only when the LAST element using it
   *  unsubscribes. Without this, slide 2's removeRef would wipe the
   *  whole entry and silently kill the watcher for slides 1+3. */
  subscribers: Set<string>;
}

interface WatchEntry {
  unwatch: () => void;
  /** Subscribed assets at this external_path, keyed by asset_id. Each
   *  asset entry tracks its own element subscribers (see SubscribedAsset). */
  assets: Map<string, SubscribedAsset>;
  /** MIME type to use when re-storing the asset (cached per first subscriber) */
  mimeType: string;
  /** Timestamp of the last handleChange for this path. macOS emits 3–7
   *  raw fs events for one save (write + truncate + close + rename-from
   *  + rename-to + ...); plugin-fs's `delayMs` doesn't actually coalesce
   *  them. We dedup here: skip handleChange if a previous one ran less
   *  than COALESCE_MS ago. Real edits that come in quick succession are
   *  picked up on the next event after the window expires. */
  lastHandledAt: number;
}

/** Min ms between handleChange calls per path. macOS atomic-save bursts
 *  fit comfortably inside this window. */
const COALESCE_MS = 250;

class WatcherRegistry {
  /** Project dir used to resolve relative external_paths to absolute. Mutable
   *  so a Finder rename can update it without rebuilding the registry. */
  public projectDir: string;
  /** Stable id this registry is bound to. Doesn't change. */
  public readonly projectId: string;

  private watchers = new Map<string, WatchEntry>();

  constructor(projectId: string, projectDir: string) {
    this.projectId = projectId;
    this.projectDir = projectDir;
  }

  /**
   * Subscribe an asset to changes of `externalRelPath` (relative to the
   * project dir). The (real, stable) `assetId` and the asset row's
   * `path` are stored so the disk-event handler can call db_store_asset
   * with the correct identity — passing a placeholder asset_id would
   * create orphan rows.
   *
   * First subscriber for a path lazily registers fs.watch; subsequent
   * subscribers just join the Map.
   */
  async addRef(externalRelPath: string, assetId: string, elementId: string, path: string, mimeType: string): Promise<void> {
    const absPath = resolvePosixPath(this.projectDir, externalRelPath);
    const existing = this.watchers.get(absPath);
    if (existing) {
      const assetEntry = existing.assets.get(assetId);
      if (assetEntry) {
        // Asset already in registry — just add this element as another
        // subscriber. Set semantics keep idempotent re-mounts safe.
        assetEntry.subscribers.add(elementId);
        wlog(`addRef join  asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} path="${path}" (now ${assetEntry.subscribers.size} elements on this asset, ${existing.assets.size} assets on this path)`);
      } else {
        // First subscriber for this asset on this already-watched path.
        existing.assets.set(assetId, { assetId, path, subscribers: new Set([elementId]) });
        wlog(`addRef join+ asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} path="${path}" (first element on this asset, ${existing.assets.size} assets on this path)`);
      }
      return;
    }
    // First reference for the path — start watching.
    wlog(`addRef new   asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} path="${path}" abs="${absPath}" — registering fs.watch...`);
    const placeholder: WatchEntry = {
      unwatch: () => {},
      assets: new Map([[assetId, { assetId, path, subscribers: new Set([elementId]) }]]),
      mimeType,
      lastHandledAt: 0,
    };
    this.watchers.set(absPath, placeholder);
    try {
      const { watch } = await import('@tauri-apps/plugin-fs');
      placeholder.unwatch = await watch(
        absPath,
        () => { wlog(`fs.watch FIRED for "${absPath}"`); void this.handleChange(absPath, externalRelPath); },
        { delayMs: 100 },
      );
      wlog(`fs.watch REGISTERED for "${absPath}"`);
    } catch (e) {
      console.warn(`[watcher] watch "${absPath}" FAILED:`, e);
    }
  }

  removeRef(externalRelPath: string, assetId: string, elementId: string): void {
    const absPath = resolvePosixPath(this.projectDir, externalRelPath);
    const entry = this.watchers.get(absPath);
    if (!entry) return;
    const assetEntry = entry.assets.get(assetId);
    if (!assetEntry) return;
    assetEntry.subscribers.delete(elementId);
    if (assetEntry.subscribers.size > 0) {
      wlog(`removeRef     asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} (${assetEntry.subscribers.size} elements left on this asset)`);
      return;
    }
    // Last element for this asset on this path — drop the asset entry.
    entry.assets.delete(assetId);
    if (entry.assets.size === 0) {
      try { entry.unwatch(); } catch { /* ignore */ }
      this.watchers.delete(absPath);
      wlog(`removeRef last asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} — unwatched "${absPath}"`);
    } else {
      wlog(`removeRef drop asset=${assetId.slice(0, 8)} element=${elementId.slice(0, 8)} (${entry.assets.size} assets left on this path)`);
    }
  }

  /**
   * Disk event for `absPath`: re-read once, fan out to every subscribed
   * asset. db_store_asset hashes and dedup-skips if bytes haven't
   * actually changed.
   */
  private async handleChange(absPath: string, externalRelPath: string): Promise<void> {
    const entry = this.watchers.get(absPath);
    if (!entry || entry.assets.size === 0) { wlog(`handleChange no subscribers for "${absPath}"`); return; }
    // Coalesce: macOS emits a burst of events for one save (write +
    // truncate + close + rename). Skip if we just handled this path.
    const sinceLast = Date.now() - entry.lastHandledAt;
    if (sinceLast < COALESCE_MS) { wlog(`handleChange coalesced (${sinceLast}ms since last) for "${absPath}"`); return; }
    entry.lastHandledAt = Date.now();
    // Asset-security gate: untrusted deck or a blocked target → skip silently
    // (snapshot stays). Only a genuinely unreadable/missing source flags #74.
    const read = await gatedExternalRead(absPath);
    if (read.status === 'gated') { wlog(`handleChange gated (untrusted/blocked) for "${absPath}"`); return; }
    if (read.status === 'unreadable') {
      wlog(`handleChange unreadable "${absPath}" → mark ${entry.assets.size} missing (#74)`);
      for (const { assetId, path } of entry.assets.values()) markAssetMissing(assetId, path);
      return;
    }
    const bytes = read.bytes;
    try {
      const { stat } = await import('@tauri-apps/plugin-fs');
      const st = await stat(absPath).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      wlog(`handleChange read ${bytes.length} bytes from "${absPath}" mtime=${mtime} → fanout to ${entry.assets.size} asset(s)`);
      for (const { assetId, path } of entry.assets.values()) {
        markAssetFound(assetId);  // a successful read means the source is back
        try {
          const writtenId = await invoke<string>('db_store_asset', {
            path,
            data: Array.from(bytes),
            mimeType: entry.mimeType,
            externalPath: externalRelPath,
            externalMtime: mtime,
            assetId,
            autoReload: null,
          });
          wlog(`  db_store_asset ok → assetId=${writtenId.slice(0, 8)} (expected ${assetId.slice(0, 8)})`);
          await invalidateRenderedAsset(assetId);
          wlog(`  invalidateRenderedAsset(${assetId.slice(0, 8)}) fired`);
        } catch (e) {
          console.warn(`[watcher] db_store_asset for ${assetId.slice(0, 8)} FAILED:`, e);
        }
      }
    } catch (e) {
      console.warn(`[watcher] store "${absPath}" FAILED:`, e);
      for (const { assetId, path } of entry.assets.values()) {
        markAssetMissing(assetId, path);
      }
    }
  }

  /** Tear down every watcher. Called on project switch or window close. */
  closeAll(): void {
    for (const entry of this.watchers.values()) {
      try { entry.unwatch(); } catch { /* ignore */ }
    }
    this.watchers.clear();
  }
}

// ============================================================================
// Module-level registry index. For multi-window future this maps each open
// project's id to its own registry; same id from two windows -> shared
// registry (correct: same disk files, one watcher set).
// ============================================================================

const registries = new Map<string, WatcherRegistry>();

export function getWatcherRegistry(projectId: string, projectDir: string): WatcherRegistry {
  let r = registries.get(projectId);
  if (!r) {
    r = new WatcherRegistry(projectId, projectDir);
    registries.set(projectId, r);
  } else if (r.projectDir !== projectDir) {
    // Project file was renamed / moved -> update the dir used for
    // resolution. Existing watchers were bound to absolute paths
    // resolved against the OLD dir; tear them down so subsequent
    // mounts re-register against the new dir.
    r.closeAll();
    r.projectDir = projectDir;
  }
  return r;
}

export function closeWatcherRegistry(projectId: string): void {
  const r = registries.get(projectId);
  if (!r) return;
  r.closeAll();
  registries.delete(projectId);
}

// ============================================================================
// Path utilities
// ============================================================================

/** POSIX-style: join an absolute dir with a possibly-../-prefixed relative
 *  path. Mac is POSIX; not used on Windows. */
export function resolvePosixPath(absDir: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const parts = (absDir + '/' + rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return '/' + out.join('/');
}

export function dirname(absPath: string): string {
  const i = absPath.lastIndexOf('/');
  return i <= 0 ? '/' : absPath.substring(0, i);
}

// ============================================================================
// Scan-on-load: catch disk edits that happened while the file was closed.
// ============================================================================

interface LinkedAssetRow {
  asset_id: string;
  path: string | null;
  external_path: string;
  external_mtime: string | null;
  auto_reload: string | null;
  mime_type: string | null;
  hash: string | null;  // SHA-256 hex of the asset bytes; used by scan
                        // to decide if a stored-mtime-vs-disk-mtime
                        // mismatch is a real byte change or just drift.
}

/**
 * After opening a project, walk every asset with a source link, stat its
 * source file, and reload any whose mtime moved since `external_mtime`.
 * Catches edits made while Eigendeck wasn't running. Returns the count
 * of assets actually reloaded.
 */
export async function scanForChangedAssets(
  projectDir: string,
  presOverride: string | null,
): Promise<{ checked: number; reloaded: number }> {
  let reloaded = 0;
  const linked = await invoke<LinkedAssetRow[]>('db_list_linked_assets').catch(() => [] as LinkedAssetRow[]);
  const globalDefault = getPreference('autoReloadAssets');
  wlog(`scanForChangedAssets: ${linked.length} linked asset(s), presOverride=${presOverride ?? 'default'}, globalAutoReload=${globalDefault}`);
  if (linked.length === 0) return { checked: 0, reloaded: 0 };
  // Asset-security: an untrusted / received deck performs ZERO disk access on open
  // — not even the #74 existence stat. Skip the whole scan; the embedded snapshots
  // render. (docs/ASSETS-SECURITY.md.) Trusted decks scan as before, with each
  // byte-read routed through the gate for realpath + type safety.
  {
    const { usePresentationStore } = await import('../store/presentation');
    const token = usePresentationStore.getState().presentation?.config?.deckToken;
    if (!token) return { checked: 0, reloaded: 0 };
    const { isTrusted } = await import('./trustStore');
    if (!(await isTrusted(token))) { wlog('scanForChangedAssets skipped — deck untrusted'); return { checked: 0, reloaded: 0 }; }
  }
  const { stat } = await import('@tauri-apps/plugin-fs');
  for (const a of linked) {
    const absPath = resolvePosixPath(projectDir, a.external_path);
    // Existence check is UNGATED by the auto-reload toggle: a missing source
    // is worth flagging even when you've opted out of live reloads (#74).
    let st;
    try {
      st = await stat(absPath);
    } catch (e) {
      markAssetMissing(a.asset_id, a.path ?? a.external_path);
      wlog(`  source-missing ${a.asset_id.slice(0, 8)} path="${a.path}" abs="${absPath}": ${e}`);
      continue;
    }
    markAssetFound(a.asset_id);  // present on disk — clear any stale flag
    // The RELOAD is gated: don't pull new bytes for assets you've opted out of.
    if (!effectiveAutoReload(a.auto_reload, presOverride, globalDefault)) {
      wlog(`  skip ${a.asset_id.slice(0, 8)} — auto_reload resolves to OFF (per-asset='${a.auto_reload ?? 'default'}', per-pres='${presOverride ?? 'default'}')`);
      continue;
    }
    try {
      const diskMtime = st?.mtime ? st.mtime.toISOString() : null;
      if (diskMtime && diskMtime !== a.external_mtime) {
        // mtime moved — read bytes and compare hash before deciding
        // whether to invalidate the rendered cache. Common case after
        // a fresh insertion (stored mtime is null) or a touch / save
        // roundtrip: mtime drifted but bytes didn't change. db_store_
        // asset's short-circuit path updates the stored mtime even
        // when bytes match, so future scans won't loop.
        // Gated read (deck already established trusted above): resolveAndGate
        // applies realpath + the asset-type check. A blocked target → skip; a
        // vanished/erroring file → flag missing (#74).
        const read = await gatedExternalRead(absPath);
        if (read.status === 'gated') { wlog(`  gated ${a.asset_id.slice(0, 8)} path="${a.path}"`); continue; }
        if (read.status === 'unreadable') { markAssetMissing(a.asset_id, a.path ?? a.external_path); continue; }
        const bytes = read.bytes;
        const diskHash = await sha256Hex(bytes);
        await invoke('db_store_asset', {
          path: a.path ?? absPath.split('/').pop() ?? a.asset_id,
          data: Array.from(bytes),
          mimeType: a.mime_type ?? 'application/octet-stream',
          externalPath: a.external_path,
          externalMtime: diskMtime,
          assetId: a.asset_id,
          autoReload: null,
        });
        if (diskHash !== a.hash) {
          // Bytes actually changed — invalidate rendered cache so the
          // sidebar + canvas re-render from the new bytes.
          wlog(`  reload ${a.asset_id.slice(0, 8)} path="${a.path}" disk=${diskMtime} stored=${a.external_mtime} (bytes changed)`);
          await invalidateRenderedAsset(a.asset_id);
          reloaded++;
        } else {
          // Just an mtime drift — bytes are identical. db_store_asset's
          // short-circuit recorded the new mtime; nothing else to do.
          wlog(`  mtime-only ${a.asset_id.slice(0, 8)} path="${a.path}" disk=${diskMtime} stored=${a.external_mtime} (bytes unchanged)`);
        }
      } else {
        wlog(`  unchanged ${a.asset_id.slice(0, 8)} path="${a.path}" mtime=${diskMtime}`);
      }
    } catch (e) {
      // The file passed stat() but vanished/erred during read — treat as missing.
      markAssetMissing(a.asset_id, a.path ?? a.external_path);
      wlog(`  source-missing ${a.asset_id.slice(0, 8)} path="${a.path}" abs="${absPath}": ${e}`);
    }
  }
  return { checked: linked.length, reloaded };
}

/**
 * Compute the directory remap between a missing source's old absolute path and
 * the new one the user just picked (#74 follow-up). Strips the common trailing
 * path (usually the filename, but any shared suffix) and returns the differing
 * directory prefixes. Returns null when there's nothing to infer (no shared
 * suffix — the file was also renamed — or identical prefixes — no move).
 * Exported for unit testing.
 */
export function deriveRelocateOffset(oldAbs: string, newAbs: string): { oldPrefix: string; newPrefix: string } | null {
  const o = oldAbs.split('/');
  const n = newAbs.split('/');
  let k = 0;
  while (k < o.length && k < n.length && o[o.length - 1 - k] === n[n.length - 1 - k]) k++;
  if (k === 0) return null;
  const oldPrefix = o.slice(0, o.length - k).join('/');
  const newPrefix = n.slice(0, n.length - k).join('/');
  if (oldPrefix === newPrefix) return null;
  return { oldPrefix, newPrefix };
}

/**
 * After the user relocates ONE missing asset (oldAbs → newAbs), try to fix the
 * OTHER currently-missing assets by applying the SAME directory move — i.e. if a
 * whole folder moved, one relocate reveals where, and the rest follow. Only
 * touches assets flagged missing; only re-points ones whose remapped file
 * actually exists on disk. Returns how many additional assets were relocated.
 */
export async function relocateMissingByOffset(
  projectDir: string,
  skipAssetId: string,
  oldAbs: string,
  newAbs: string,
): Promise<{ relocated: number; checked: number }> {
  const offset = deriveRelocateOffset(oldAbs, newAbs);
  if (!offset) return { relocated: 0, checked: 0 };
  const { oldPrefix, newPrefix } = offset;
  const linked = await invoke<LinkedAssetRow[]>('db_list_linked_assets').catch(() => [] as LinkedAssetRow[]);
  const { stat } = await import('@tauri-apps/plugin-fs');
  let relocated = 0, checked = 0;
  for (const a of linked) {
    if (a.asset_id === skipAssetId || !isAssetMissing(a.asset_id)) continue;
    const absOld = resolvePosixPath(projectDir, a.external_path);
    if (absOld !== oldPrefix && !absOld.startsWith(oldPrefix + '/')) continue;  // outside the moved tree
    const candidate = newPrefix + absOld.slice(oldPrefix.length);
    checked++;
    try {
      // The user relocated the anchor file, revealing this whole folder moved; the
      // siblings within it inherit that consent. Approve each (keyed by its asset id,
      // so it replaces that asset's old approval in place) on the trusted deck — same
      // single approval path as add/relocate — so the gated read accepts it.
      const { approveExternalAbsPath } = await import('./assetInsert');
      await approveExternalAbsPath(a.asset_id, candidate, 'relocate-folder');
      // Gated read: untrusted deck or a blocked/wrong-type relocation target → skip.
      const read = await gatedExternalRead(candidate);
      if (read.status !== 'ok') continue;
      const bytes = read.bytes;
      const st = await stat(candidate).catch(() => null);
      await invoke('db_store_asset', {
        path: a.path ?? candidate.split('/').pop() ?? a.asset_id,
        data: Array.from(bytes),
        mimeType: a.mime_type ?? 'application/octet-stream',
        externalPath: candidate,
        externalMtime: st?.mtime ? st.mtime.toISOString() : null,
        assetId: a.asset_id,
        autoReload: null,
      });
      await invalidateRenderedAsset(a.asset_id);
      markAssetFound(a.asset_id);
      relocated++;
    } catch { /* not at the remapped location either — leave it flagged missing */ }
  }
  return { relocated, checked };
}
