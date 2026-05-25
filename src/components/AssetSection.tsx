// Properties-panel section for an ImageElement: shows the asset's
// linked source path, last-modified mtime, current auto-reload
// resolution, Reload Now button, auto-reload tri-state toggle, and a
// scrollable version history with Restore buttons.
//
// Updates live: subscribes to the `eigendeck:asset-changed` event the
// file watcher fires after each disk reload, so the history list
// extends in place.

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { invalidateRenderedAsset } from '../lib/assetRenderer';
import { dirname, resolvePosixPath } from '../lib/watcherRegistry';
import { effectiveAutoReload, usePreference } from '../lib/preferences';

interface AssetMeta {
  asset_id: string;
  path: string | null;
  external_path: string | null;
  external_mtime: string | null;
  mime_type: string | null;
  auto_reload: string | null;
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  } catch { return iso; }
}

function relativeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function AssetSection({ srcPath }: { srcPath: string }) {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [history, setHistory] = useState<AssetVersion[]>([]);
  const [reloading, setReloading] = useState(false);
  const [globalAutoReload] = usePreference('autoReloadAssets');
  const presOverride = usePresentationStore((s) => s.presentation?.config?.autoReloadAssets ?? null);

  const fetchMeta = useCallback(async () => {
    const m = await invoke<AssetMeta | null>('db_get_asset_meta_by_path', { path: srcPath })
      .catch(() => null);
    setMeta(m);
    if (m) {
      const hist = await invoke<AssetVersion[]>('db_get_asset_history', { assetId: m.asset_id })
        .catch(() => []);
      setHistory(hist);
    } else {
      setHistory([]);
    }
  }, [srcPath]);

  useEffect(() => { void fetchMeta(); }, [fetchMeta]);

  // Refetch on asset-changed (watcher reloads, restore, manual reload).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path === srcPath) void fetchMeta();
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [srcPath, fetchMeta]);

  const reloadNow = useCallback(async () => {
    if (!meta?.external_path || !projectPath) return;
    setReloading(true);
    try {
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      const absPath = resolvePosixPath(dirname(projectPath), meta.external_path);
      const bytes = await readFile(absPath);
      const st = await stat(absPath).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      await invoke('db_store_asset', {
        path: meta.path ?? srcPath,
        data: Array.from(bytes),
        mimeType: meta.mime_type ?? 'application/octet-stream',
        externalPath: meta.external_path,
        externalMtime: mtime,
        assetId: meta.asset_id,
        autoReload: null,
      });
      await invalidateRenderedAsset(meta.path ?? srcPath);
    } catch (e) {
      console.warn('[AssetSection] reload failed:', e);
    } finally {
      setReloading(false);
    }
  }, [meta, projectPath, srcPath]);

  const setAutoReload = useCallback(async (value: 'on' | 'off' | null) => {
    if (!meta) return;
    await invoke('db_set_asset_auto_reload', { assetId: meta.asset_id, value }).catch(() => {});
    await fetchMeta();
  }, [meta, fetchMeta]);

  const restoreVersion = useCallback(async (valid_from: string) => {
    if (!meta) return;
    if (!confirm('Restore this version? Current bytes will be moved to history; auto-reload will be turned off so the watcher doesn\'t overwrite the restore.')) return;
    await invoke('db_restore_asset_version', { assetId: meta.asset_id, validFrom: valid_from }).catch((e) => {
      console.warn('[AssetSection] restore failed:', e);
    });
    await invalidateRenderedAsset(meta.path ?? srcPath);
  }, [meta, srcPath]);

  if (!meta) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#999' }}>
        Not yet stored — drag the file in or save the project to enable asset tracking.
      </div>
    );
  }

  const effective = effectiveAutoReload(meta.auto_reload, presOverride, globalAutoReload);
  const triState = (meta.auto_reload ?? 'default') as 'on' | 'off' | 'default';
  const presLabel = presOverride === 'on' ? 'always' : presOverride === 'off' ? 'never' : `follow global (${globalAutoReload ? 'on' : 'off'})`;

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Path + source */}
      <div style={{ fontSize: 11 }}>
        <div style={{ color: '#666', marginBottom: 2 }}>Path</div>
        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{meta.path ?? '(unnamed)'}</div>
      </div>
      <div style={{ fontSize: 11 }}>
        <div style={{ color: '#666', marginBottom: 2 }}>Source file</div>
        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: meta.external_path ? '#222' : '#999' }}>
          {meta.external_path ?? '(no source link — pasted or embedded snapshot)'}
        </div>
        {meta.external_mtime && (
          <div style={{ color: '#888', marginTop: 2 }}>last loaded: {fmtTime(meta.external_mtime)}</div>
        )}
      </div>

      {/* Asset tracking is impossible in unnamed presentations: the
          source file path can't be resolved without a project dir on
          disk. Replace the controls with an explanatory bar + Save
          shortcut. */}
      {meta.external_path && !projectPath && (
        <div style={{
          fontSize: 11, padding: '6px 8px',
          background: '#fffbeb', border: '1px solid #fcd34d',
          borderRadius: 3, color: '#92400e',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ flex: 1 }}>
            Asset tracking is not available in unnamed presentations.
            Save the presentation to enable live updates from the source file.
          </span>
          <button
            onClick={() => { void import('../store/fileOps').then(({ saveProject }) => saveProject()); }}
            style={{
              padding: '3px 8px', fontSize: 11,
              background: '#f59e0b', color: '#fff',
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}>
            Save…
          </button>
        </div>
      )}

      {/* Auto-reload tri-state — only meaningful when the project has a
          dir to resolve external_path against. */}
      {meta.external_path && projectPath && (
        <div style={{ fontSize: 11 }}>
          <div style={{ color: '#666', marginBottom: 4 }}>
            Auto-reload <span style={{ color: '#888' }}>
              (presentation: {presLabel}; effective: <b>{effective ? 'ON' : 'OFF'}</b>)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['default', 'on', 'off'] as const).map((v) => (
              <button key={v}
                onClick={() => setAutoReload(v === 'default' ? null : v)}
                style={{
                  padding: '3px 8px', fontSize: 11,
                  background: triState === v ? '#3b82f6' : '#f3f4f6',
                  color: triState === v ? '#fff' : '#222',
                  border: '1px solid #ddd', borderRadius: 3,
                  cursor: 'pointer',
                }}>
                {v === 'default' ? 'Follow global' : v === 'on' ? 'Always' : 'Never'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual reload — same gate; the button would no-op without
          projectPath anyway. */}
      {meta.external_path && projectPath && (
        <button onClick={reloadNow} disabled={reloading}
          style={{
            padding: '4px 10px', fontSize: 12, alignSelf: 'flex-start',
            border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer',
            background: reloading ? '#eee' : '#fff',
          }}>
          {reloading ? 'Reloading…' : 'Reload from disk now'}
        </button>
      )}

      {/* Version history */}
      <div style={{ fontSize: 11 }}>
        <div style={{ color: '#666', marginBottom: 4 }}>
          Versions ({history.length})
        </div>
        <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eee', borderRadius: 3 }}>
          {history.length === 0 && (
            <div style={{ padding: '6px 8px', color: '#999' }}>No versions yet.</div>
          )}
          {history.map((v, i) => {
            const isCurrent = v.valid_to === null;
            return (
              <div key={v.valid_from} style={{
                padding: '6px 8px',
                borderTop: i > 0 ? '1px solid #f0f0f0' : 'none',
                background: isCurrent ? '#eff6ff' : '#fff',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#666' }}>
                    {v.valid_from.slice(0, 19)} <span style={{ color: '#aaa' }}>({relativeAgo(v.valid_from)})</span>
                  </div>
                  <div style={{ color: '#888' }}>
                    {fmtBytes(v.size)}{isCurrent ? ' · current' : ''}
                  </div>
                </div>
                {!isCurrent && (
                  <button onClick={() => restoreVersion(v.valid_from)}
                    style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer' }}>
                    Restore
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
