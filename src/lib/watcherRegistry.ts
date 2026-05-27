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
import { invalidateRenderedAsset } from './assetRenderer';
import { effectiveAutoReload, getPreference } from './preferences';

// Verbose logging surfaces in the in-app Debug Console (View menu)
// because console.log is intercepted there. Prefix `[watcher]` so the
// user can filter or scroll for them. Kept on by default while the
// watcher's behavior is being debugged; flip the const to disable.
const WATCHER_LOG = true;
const wlog = (...a: unknown[]): void => {
  if (WATCHER_LOG) console.log(`[watcher ${new Date().toISOString().slice(11, 23)}]`, ...a);
};

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
    try {
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(absPath);
      const st = await stat(absPath).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      wlog(`handleChange read ${bytes.length} bytes from "${absPath}" mtime=${mtime} → fanout to ${entry.assets.size} asset(s)`);
      for (const { assetId, path } of entry.assets.values()) {
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
      console.warn(`[watcher] readFile/stat "${absPath}" FAILED:`, e);
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
  const { stat, readFile } = await import('@tauri-apps/plugin-fs');
  for (const a of linked) {
    if (!effectiveAutoReload(a.auto_reload, presOverride, globalDefault)) {
      wlog(`  skip ${a.asset_id.slice(0, 8)} — auto_reload resolves to OFF (per-asset='${a.auto_reload ?? 'default'}', per-pres='${presOverride ?? 'default'}')`);
      continue;
    }
    const absPath = resolvePosixPath(projectDir, a.external_path);
    try {
      const st = await stat(absPath);
      const diskMtime = st?.mtime ? st.mtime.toISOString() : null;
      if (diskMtime && diskMtime !== a.external_mtime) {
        wlog(`  reload ${a.asset_id.slice(0, 8)} path="${a.path}" disk=${diskMtime} stored=${a.external_mtime}`);
        const bytes = await readFile(absPath);
        await invoke('db_store_asset', {
          path: a.path ?? absPath.split('/').pop() ?? a.asset_id,
          data: Array.from(bytes),
          mimeType: a.mime_type ?? 'application/octet-stream',
          externalPath: a.external_path,
          externalMtime: diskMtime,
          assetId: a.asset_id,
          autoReload: null,
        });
        await invalidateRenderedAsset(a.asset_id);
        reloaded++;
      } else {
        wlog(`  unchanged ${a.asset_id.slice(0, 8)} path="${a.path}" mtime=${diskMtime}`);
      }
    } catch (e) {
      wlog(`  source-missing ${a.asset_id.slice(0, 8)} path="${a.path}" abs="${absPath}": ${e}`);
    }
  }
  return { checked: linked.length, reloaded };
}
