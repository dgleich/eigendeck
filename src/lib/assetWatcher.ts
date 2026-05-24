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

/**
 * Watch the source file behind an asset (if any) and auto-reload the
 * stored bytes when it changes on disk. No-op when:
 *   - the asset has no external_path (e.g. pasted from clipboard,
 *     embedded as snapshot, or restored from history with auto_reload='off')
 *   - the presentation isn't saved yet (no project dir to resolve against)
 *
 * Idempotent across re-mounts; safely unwatches on unmount or input change.
 *
 * NOTE: takes `assetPath` (the path label) as the lookup key for backward
 * compatibility with existing element data. The lookup
 * db_get_asset_external_path uses path; for new code paths that already
 * know the asset_id, prefer using the registry directly.
 */
export function useAssetFileWatcher(assetPath: string | undefined, mimeType: string): void {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [projectId, setProjectId] = useState<string | null>(null);

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
    if (!assetPath || !projectPath || !projectId) return;
    let cancelled = false;
    let registeredPath: string | null = null;
    let registeredAssetId: string | null = null;

    (async () => {
      // Look up the asset's external_path (relative to project dir).
      const externalRel = await invoke<string | null>('db_get_asset_external_path', {
        path: assetPath,
      }).catch(() => null);
      if (!externalRel || cancelled) return;

      // For correctness with the new registry's per-asset_id fan-out we'd
      // want the asset_id; but the existing element data only carries
      // path. Use path itself as the subscription key — db_store_asset
      // will resolve to the right asset_id via its legacy path lookup.
      // Once ImageElement.assetId lands (next commit) this can switch
      // to the real id directly.
      const subscriptionKey = `path:${assetPath}`;
      const registry = getWatcherRegistry(projectId, dirname(projectPath));
      await registry.addRef(externalRel, subscriptionKey, mimeType);
      registeredPath = externalRel;
      registeredAssetId = subscriptionKey;
    })();

    return () => {
      cancelled = true;
      if (registeredPath && registeredAssetId && projectId) {
        const registry = getWatcherRegistry(projectId, dirname(projectPath));
        registry.removeRef(registeredPath, registeredAssetId);
      }
    };
  }, [assetPath, mimeType, projectPath, projectId]);
}
