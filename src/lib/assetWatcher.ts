// useAssetFileWatcher — thin React wrapper around the per-project
// WatcherRegistry. Each component that displays an asset (sidebar
// thumbnail, editor canvas, presenter) mounts this hook for the asset
// it's showing; the registry dedups so multiple subscribers for the
// same source path share one fs.watch.
//
// All the actual work (resolving paths, kernel watch, reload + invalidate
// fan-out) lives in src/lib/watcherRegistry.ts. This file is just the
// React glue: get the registry by project_id on mount, addRef the
// asset's source path, removeRef on cleanup.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { getWatcherRegistry, dirname } from './watcherRegistry';
import { effectiveAutoReload, usePreference } from './preferences';

// Logs surface in the Debug Console (View menu intercepts console.log).
const HOOK_LOG = true;
const hlog = (...a: unknown[]): void => {
  if (HOOK_LOG) console.log(`[watcher-hook ${new Date().toISOString().slice(11, 23)}]`, ...a);
};

interface AssetMeta {
  asset_id: string;
  path: string | null;
  external_path: string | null;
  external_mtime: string | null;
  mime_type: string | null;
  auto_reload: string | null;
}

/**
 * Watch the source file behind an asset (if any) and auto-reload the
 * stored bytes when it changes on disk. No-op when:
 *   - the asset has no external_path (e.g. pasted from clipboard,
 *     embedded as snapshot, or restored from history with auto_reload='off')
 *   - the presentation isn't saved yet (no project dir to resolve against)
 *
 * Looks up the asset's real asset_id by path label (the element's `src`)
 * so disk-event writes target the correct row instead of orphaning into
 * a new asset.
 *
 * Idempotent across re-mounts; safely unwatches on unmount or input change.
 */
export function useAssetFileWatcher(assetPath: string | undefined, mimeType: string): void {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Global default; per-asset auto_reload overrides via effectiveAutoReload.
  const [globalAutoReload] = usePreference('autoReloadAssets');

  // Fetch project_id once the project is loaded.
  useEffect(() => {
    if (!projectPath) { setProjectId(null); return; }
    let cancelled = false;
    invoke<string>('db_get_project_id')
      .then((id) => { if (!cancelled) setProjectId(id); })
      .catch(() => { if (!cancelled) setProjectId(null); });
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    if (!assetPath || !projectPath || !projectId) {
      if (assetPath) hlog(`skip mount for "${assetPath}" — projectPath=${!!projectPath} projectId=${!!projectId}`);
      return;
    }
    let cancelled = false;
    let registeredExternalRel: string | null = null;
    let registeredAssetId: string | null = null;

    (async () => {
      const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_path', {
        path: assetPath,
      }).catch((e) => { hlog(`meta lookup FAILED for "${assetPath}":`, e); return null; });
      if (cancelled) return;
      if (!meta) {
        hlog(`no asset meta for "${assetPath}" — nothing to watch (asset not yet stored, or path mismatch)`);
        return;
      }
      hlog(`meta for "${assetPath}": asset_id=${meta.asset_id.slice(0, 8)} external_path=${meta.external_path} mtime=${meta.external_mtime} auto_reload=${meta.auto_reload}`);
      const effective = effectiveAutoReload(meta.auto_reload, globalAutoReload);
      if (!effective) {
        hlog(`skip — auto_reload resolves to OFF (per-asset='${meta.auto_reload ?? 'default'}', global=${globalAutoReload})`);
        return;
      }
      if (!meta.external_path) {
        hlog(`skip — no external_path for "${assetPath}" (e.g. pasted, snapshot, or never linked)`);
        return;
      }

      const registry = getWatcherRegistry(projectId, dirname(projectPath));
      const origPath = meta.path ?? assetPath;
      const effectiveMime = meta.mime_type ?? mimeType;
      await registry.addRef(meta.external_path, meta.asset_id, origPath, effectiveMime);
      registeredExternalRel = meta.external_path;
      registeredAssetId = meta.asset_id;
    })();

    return () => {
      cancelled = true;
      if (registeredExternalRel && registeredAssetId && projectId) {
        const registry = getWatcherRegistry(projectId, dirname(projectPath));
        registry.removeRef(registeredExternalRel, registeredAssetId);
      }
    };
  }, [assetPath, mimeType, projectPath, projectId, globalAutoReload]);
}
