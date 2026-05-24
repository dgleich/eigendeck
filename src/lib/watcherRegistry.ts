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

interface WatchEntry {
  unwatch: () => void;
  /** asset_ids currently subscribed to this external_path */
  assetIds: Set<string>;
  /** MIME type to use when re-storing the asset (cached per first subscriber) */
  mimeType: string;
}

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
   * Subscribe `assetId` to changes of `externalRelPath` (relative to the
   * project dir). First subscriber for a path lazily registers fs.watch;
   * subsequent subscribers just join the Set.
   */
  async addRef(externalRelPath: string, assetId: string, mimeType: string): Promise<void> {
    const absPath = resolvePosixPath(this.projectDir, externalRelPath);
    const existing = this.watchers.get(absPath);
    if (existing) {
      existing.assetIds.add(assetId);
      return;
    }
    // First reference — start watching.
    const placeholder: WatchEntry = {
      unwatch: () => {},
      assetIds: new Set([assetId]),
      mimeType,
    };
    this.watchers.set(absPath, placeholder);
    try {
      const { watch } = await import('@tauri-apps/plugin-fs');
      placeholder.unwatch = await watch(
        absPath,
        () => { void this.handleChange(absPath, externalRelPath); },
        { delayMs: 100 },
      );
    } catch (e) {
      // watch() failed (no permission, path doesn't exist, etc.). Leave
      // the entry in place so future addRef calls don't keep retrying;
      // disk changes simply won't trigger reloads for this path.
      console.warn(`[watcherRegistry] watch ${absPath} failed:`, e);
    }
  }

  removeRef(externalRelPath: string, assetId: string): void {
    const absPath = resolvePosixPath(this.projectDir, externalRelPath);
    const entry = this.watchers.get(absPath);
    if (!entry) return;
    entry.assetIds.delete(assetId);
    if (entry.assetIds.size === 0) {
      try { entry.unwatch(); } catch { /* ignore */ }
      this.watchers.delete(absPath);
    }
  }

  /**
   * Disk event for `absPath`: re-read once, fan out to all subscribed
   * asset_ids. db_store_asset hashes and dedup-skips if bytes haven't
   * actually changed.
   */
  private async handleChange(absPath: string, externalRelPath: string): Promise<void> {
    const entry = this.watchers.get(absPath);
    if (!entry || entry.assetIds.size === 0) return;
    let bytes: Uint8Array;
    try {
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      bytes = await readFile(absPath);
      // Capture mtime for staleness detection on the asset row.
      const st = await stat(absPath).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      for (const assetId of entry.assetIds) {
        try {
          await invoke('db_store_asset', {
            path: absPath.split('/').pop() ?? assetId,
            data: Array.from(bytes),
            mimeType: entry.mimeType,
            externalPath: externalRelPath,
            externalMtime: mtime,
            assetId,
            autoReload: null,
          });
          await invalidateRenderedAsset(assetId);
        } catch (e) {
          console.warn(`[watcherRegistry] reload ${assetId} failed:`, e);
        }
      }
    } catch (e) {
      // Source file deleted / moved / mid-atomic-rename. Ignore;
      // a subsequent event will retry (or the user notices in the
      // Properties panel via the source-missing flag).
      console.warn(`[watcherRegistry] read ${absPath} failed:`, e);
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
export async function scanForChangedAssets(projectDir: string): Promise<{ checked: number; reloaded: number }> {
  let reloaded = 0;
  const linked = await invoke<LinkedAssetRow[]>('db_list_linked_assets').catch(() => [] as LinkedAssetRow[]);
  if (linked.length === 0) return { checked: 0, reloaded: 0 };
  const { stat, readFile } = await import('@tauri-apps/plugin-fs');
  for (const a of linked) {
    // Honor per-asset auto_reload === 'off' (Restore sets this).
    if (a.auto_reload === 'off') continue;
    const absPath = resolvePosixPath(projectDir, a.external_path);
    try {
      const st = await stat(absPath);
      const diskMtime = st?.mtime ? st.mtime.toISOString() : null;
      if (diskMtime && diskMtime !== a.external_mtime) {
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
      }
    } catch {
      // Source missing or unreadable — skip. Could surface as
      // "source-missing" flag in Properties panel later.
    }
  }
  return { checked: linked.length, reloaded };
}
