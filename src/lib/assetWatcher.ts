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
const HOOK_LOG = false;  // flip true to debug watcher mount/skip decisions
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
 * Idempotent across re-mounts; safely unwatches on unmount or input change.
 */
export function useAssetFileWatcher(
  assetId: string | undefined,
  elementId: string,
): void {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [projectId, setProjectId] = useState<string | null>(null);
  // 3-layer cascade: per-asset > per-presentation > global default.
  const [globalAutoReload] = usePreference('autoReloadAssets');
  const presOverride = usePresentationStore((s) => s.presentation?.config?.autoReloadAssets ?? null);

  // Bumped when an asset-changed event arrives matching this asset. The
  // event fires when meta changes (auto_reload toggled, asset restored,
  // watcher wrote a new version). Triggering a refetch lets us pick up
  // auto_reload flips: if the user just unchecked Watch, the cascade
  // re-evaluates to false and the cleanup unsubscribes us. Without this
  // the subscription persisted across the flip — the file watcher kept
  // firing despite the user opting out.
  const [refetchKey, setRefetchKey] = useState(0);

  // Fetch project_id once the project is loaded.
  useEffect(() => {
    if (!projectPath) { setProjectId(null); return; }
    let cancelled = false;
    invoke<string>('db_get_project_id')
      .then((id) => { if (!cancelled) setProjectId(id); })
      .catch(() => { if (!cancelled) setProjectId(null); });
    return () => { cancelled = true; };
  }, [projectPath]);

  // Listen for asset-changed events that match our asset. On match,
  // bump refetchKey to re-run the subscription effect below (which
  // refetches meta and re-evaluates the cascade).
  useEffect(() => {
    if (!assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) {
        hlog(`asset-changed event for asset=${assetId.slice(0, 8)} → refetching meta + re-evaluating cascade`);
        setRefetchKey((k) => k + 1);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId]);

  useEffect(() => {
    if (!assetId || !projectPath || !projectId) {
      if (assetId) hlog(`skip mount for asset=${assetId.slice(0, 8)} — projectPath=${!!projectPath} projectId=${!!projectId}`);
      return;
    }
    let cancelled = false;
    let registeredExternalRel: string | null = null;
    let registeredAssetId: string | null = null;

    (async () => {
      const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_id', { assetId })
        .catch((e) => { hlog(`meta-by-id lookup FAILED for ${assetId.slice(0, 8)}:`, e); return null; });
      if (cancelled) return;
      if (!meta) {
        hlog(`no asset meta for asset=${assetId.slice(0, 8)} — nothing to watch`);
        return;
      }
      hlog(`meta for ${assetId.slice(0, 8)}: path="${meta.path}" external_path=${meta.external_path} mtime=${meta.external_mtime} auto_reload=${meta.auto_reload}`);
      const effective = effectiveAutoReload(meta.auto_reload, presOverride, globalAutoReload);
      if (!effective) {
        hlog(`skip — auto_reload resolves to OFF (per-asset='${meta.auto_reload ?? 'default'}', per-pres='${presOverride ?? 'default'}', global=${globalAutoReload})`);
        return;
      }
      if (!meta.external_path) {
        hlog(`skip — no external_path for asset=${meta.asset_id.slice(0, 8)} (e.g. pasted, snapshot, or never linked)`);
        return;
      }

      const registry = getWatcherRegistry(projectId, dirname(projectPath));
      const origPath = meta.path ?? meta.asset_id;
      const effectiveMime = meta.mime_type ?? 'application/octet-stream';
      await registry.addRef(meta.external_path, meta.asset_id, elementId, origPath, effectiveMime);
      registeredExternalRel = meta.external_path;
      registeredAssetId = meta.asset_id;
    })();

    return () => {
      cancelled = true;
      if (registeredExternalRel && registeredAssetId && projectId) {
        const registry = getWatcherRegistry(projectId, dirname(projectPath));
        registry.removeRef(registeredExternalRel, registeredAssetId, elementId);
      }
    };
  }, [assetId, elementId, projectPath, projectId, globalAutoReload, presOverride, refetchKey]);
}
