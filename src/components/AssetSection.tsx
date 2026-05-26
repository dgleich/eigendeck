// Properties-panel section for an ImageElement: shows the asset's
// linked source path, last-modified mtime, current auto-reload
// resolution, Reload Now button, auto-reload tri-state toggle, and a
// scrollable version history with Restore buttons.
//
// Updates live: subscribes to the `eigendeck:asset-changed` event the
// file watcher fires after each disk reload, so the history list
// extends in place.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

/** Guess a blob MIME type for a version's preview from its stored
 *  mime_type or path extension. PDFs and HTML demos render as a
 *  placeholder; everything else gets the raw blob. */
function previewMimeFor(mimeType: string | null | undefined, path: string | null | undefined): string | null {
  const m = (mimeType || '').toLowerCase();
  if (m === 'image/svg+xml' || m.startsWith('image/')) return mimeType!;
  if (m === 'application/pdf') return null;  // pdfium not wired
  if (m === 'text/html') return null;  // demo HTML — not previewable as image
  // Fallback: sniff from extension
  const ext = (path || '').split('.').pop()?.toLowerCase() || '';
  const guess: Record<string, string> = {
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  };
  return guess[ext] ?? null;
}

export function AssetSection({ srcPath, assetId, elementId }: { srcPath: string; assetId?: string; elementId?: string }) {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [history, setHistory] = useState<AssetVersion[]>([]);
  const [reloading, setReloading] = useState(false);
  const [globalAutoReload] = usePreference('autoReloadAssets');
  const presOverride = usePresentationStore((s) => s.presentation?.config?.autoReloadAssets ?? null);

  const fetchMeta = useCallback(async () => {
    // Prefer asset_id lookup when bound (unambiguous when two assets share a path);
    // fall back to path for legacy elements without an assetId binding.
    const m = assetId
      ? await invoke<AssetMeta | null>('db_get_asset_meta_by_id', { assetId }).catch(() => null)
      : await invoke<AssetMeta | null>('db_get_asset_meta_by_path', { path: srcPath }).catch(() => null);
    setMeta(m);
    if (m) {
      const hist = await invoke<AssetVersion[]>('db_get_asset_history', { assetId: m.asset_id })
        .catch(() => []);
      setHistory(hist);
    } else {
      setHistory([]);
    }
  }, [srcPath, assetId]);

  useEffect(() => { void fetchMeta(); }, [fetchMeta]);

  // Refetch on asset-changed (watcher reloads, restore, manual reload).
  // Match by assetId when both event and binding have one; else by path.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; assetId?: string } | undefined;
      const matches = assetId && detail?.assetId
        ? detail.assetId === assetId
        : detail?.path === srcPath;
      if (matches) void fetchMeta();
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [srcPath, assetId, fetchMeta]);

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
      await invalidateRenderedAsset(meta.path ?? srcPath, meta.asset_id);
    } catch (e) {
      console.warn('[AssetSection] reload failed:', e);
    } finally {
      setReloading(false);
    }
  }, [meta, projectPath, srcPath]);

  const setAutoReload = useCallback(async (value: 'on' | 'off' | null) => {
    if (!meta) return;
    // If this asset is bound by multiple elements (e.g. user added the
    // same image to slides 1, 2, 3), the tri-state lives in a per-
    // ELEMENT panel — the user expects per-element semantics. Setting
    // auto_reload on the shared asset row would affect every bound
    // element, not just this one. Fork in that case: create a new
    // asset_id with current bytes + the chosen auto_reload, rebind
    // THIS element to it; other elements stay on the original asset.
    const pres = usePresentationStore.getState().presentation;
    let usageCount = 0;
    if (pres) {
      for (const slide of pres.slides) {
        for (const el of slide.elements) {
          if (el.type !== 'image' && el.type !== 'demo' && el.type !== 'demo-piece') continue;
          const e = el as { assetId?: string; src?: string; demoSrc?: string };
          const isBound = e.assetId
            ? e.assetId === meta.asset_id
            : (e.demoSrc ?? e.src) === meta.path;
          if (isBound) usageCount++;
        }
      }
    }
    if (usageCount <= 1 || !elementId) {
      // Solo asset (or no elementId to rebind): in-place flip is correct.
      await invoke('db_set_asset_auto_reload', { assetId: meta.asset_id, value }).catch(() => {});
    } else {
      // Shared asset: fork.
      try {
        const bytes = await invoke<number[]>('db_get_asset_by_id', { assetId: meta.asset_id });
        const newAssetId = crypto.randomUUID();
        await invoke('db_store_asset', {
          path: meta.path,
          data: bytes,
          mimeType: meta.mime_type,
          externalPath: meta.external_path,
          externalMtime: meta.external_mtime,
          assetId: newAssetId,
          autoReload: value,
        });
        usePresentationStore.getState().updateElement(elementId, { assetId: newAssetId } as any);
        console.log(`[AssetSection] forked shared asset ${meta.asset_id.slice(0, 8)} → ${newAssetId.slice(0, 8)} (${usageCount} elements shared; rebinding element ${elementId})`);
      } catch (e) {
        console.warn('[AssetSection] fork failed:', e);
      }
    }
    await fetchMeta();
  }, [meta, elementId, fetchMeta]);

  const restoreVersion = useCallback(async (valid_from: string) => {
    if (!meta) return;
    // Same shared-asset issue as the tri-state: restoring an asset
    // row affects every element bound to it. To get per-element
    // semantics on shared assets, fork — create a new asset with the
    // restored version's bytes, rebind THIS element to it. Other
    // elements stay on the original asset, unchanged.
    const pres = usePresentationStore.getState().presentation;
    let usageCount = 0;
    if (pres) {
      for (const slide of pres.slides) {
        for (const el of slide.elements) {
          if (el.type !== 'image' && el.type !== 'demo' && el.type !== 'demo-piece') continue;
          const e = el as { assetId?: string; src?: string; demoSrc?: string };
          const isBound = e.assetId
            ? e.assetId === meta.asset_id
            : (e.demoSrc ?? e.src) === meta.path;
          if (isBound) usageCount++;
        }
      }
    }
    const isShared = usageCount > 1 && !!elementId;
    const msg = isShared
      ? `Restore this version on THIS element only? (The asset is used on ${usageCount} elements; this will fork it — other elements stay at their current version.)`
      : 'Restore this version? Current bytes will be moved to history; auto-reload will be turned off so the watcher doesn\'t overwrite the restore.';
    if (!confirm(msg)) return;

    if (!isShared) {
      // Solo asset: in-place restore (writes new current row with old
      // bytes; sets auto_reload='off' on the restored row).
      await invoke('db_restore_asset_version', { assetId: meta.asset_id, validFrom: valid_from }).catch((e) => {
        console.warn('[AssetSection] restore failed:', e);
      });
      await invalidateRenderedAsset(meta.path ?? srcPath, meta.asset_id);
      return;
    }

    // Shared asset: fork.
    try {
      const bytes = await invoke<number[]>('db_get_asset_version', {
        assetId: meta.asset_id, validFrom: valid_from,
      });
      const newAssetId = crypto.randomUUID();
      await invoke('db_store_asset', {
        path: meta.path,
        data: bytes,
        mimeType: meta.mime_type,
        externalPath: meta.external_path,
        externalMtime: meta.external_mtime,
        assetId: newAssetId,
        autoReload: 'off',  // match the in-place restore's semantic: don't auto-overwrite the restore
      });
      usePresentationStore.getState().updateElement(elementId!, { assetId: newAssetId } as any);
      console.log(`[AssetSection] forked shared asset ${meta.asset_id.slice(0, 8)} → ${newAssetId.slice(0, 8)} on restore (${usageCount} elements shared; rebinding element ${elementId})`);
    } catch (e) {
      console.warn('[AssetSection] fork-on-restore failed:', e);
    }
  }, [meta, srcPath, elementId]);

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
          {history.map((v, i) => (
            <VersionRow key={v.valid_from} version={v} isFirst={i === 0}
              mimeType={meta.mime_type} path={meta.path ?? srcPath}
              onRestore={() => restoreVersion(v.valid_from)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One row in the version history list. Relative-time as the primary label
 * with the full ISO timestamp on hover via `title`. On mouseEnter, lazy-
 * fetches that specific version's bytes (db_get_asset_version) and shows
 * a thumbnail in a floating popover so the user can see what the asset
 * looked like at that point in time. Blob URL is revoked on mouseLeave /
 * unmount.
 */
function VersionRow({
  version: v, isFirst, mimeType, path, onRestore,
}: {
  version: AssetVersion;
  isFirst: boolean;
  mimeType: string | null;
  path: string;
  onRestore: () => void;
}) {
  const isCurrent = v.valid_to === null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const previewMime = previewMimeFor(mimeType, path);

  // Lazy-load on first hover. Caches per-row so subsequent hovers
  // re-show the same blob URL without re-fetching.
  const handleEnter = useCallback(async () => {
    setHovered(true);
    if (rowRef.current) {
      const r = rowRef.current.getBoundingClientRect();
      // Position the popover to the LEFT of the inspector row, vertically
      // anchored to the row's top. 8px gap + 160px popover width.
      setPopoverPos({ top: r.top, left: r.left - 168 });
    }
    if (previewUrl !== null || previewError || !previewMime) return;
    try {
      const data = await invoke<number[]>('db_get_asset_version', {
        assetId: v.asset_id, validFrom: v.valid_from,
      });
      const blob = new Blob([new Uint8Array(data)], { type: previewMime });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setPreviewError(true);
    }
  }, [previewUrl, previewError, previewMime, v.asset_id, v.valid_from]);

  const handleLeave = useCallback(() => {
    setHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div ref={rowRef}
      onMouseEnter={handleEnter} onMouseLeave={handleLeave}
      style={{
        padding: '6px 8px',
        borderTop: isFirst ? 'none' : '1px solid #f0f0f0',
        background: isCurrent ? '#eff6ff' : '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <div title={fmtTime(v.valid_from)} style={{ color: '#222' }}>
          {relativeAgo(v.valid_from)}{isCurrent && <span style={{ color: '#3b82f6', marginLeft: 6, fontWeight: 500 }}>current</span>}
        </div>
        <div style={{ color: '#888', fontSize: 10 }}>{fmtBytes(v.size)}</div>
      </div>
      {!isCurrent && (
        <button onClick={onRestore}
          style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer' }}>
          Restore
        </button>
      )}
      {hovered && popoverPos && createPortal(
        <div style={{
          position: 'fixed', top: popoverPos.top, left: popoverPos.left,
          width: 160,
          background: '#fff', border: '1px solid #ccc', borderRadius: 4,
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          padding: 6, zIndex: 10000, pointerEvents: 'none',
        }}>
          {!previewMime ? (
            <div style={{ fontSize: 10, color: '#888', textAlign: 'center', padding: '20px 0' }}>
              No preview<br />({mimeType || 'unknown type'})
            </div>
          ) : previewError ? (
            <div style={{ fontSize: 10, color: '#888', textAlign: 'center', padding: '20px 0' }}>
              Preview failed
            </div>
          ) : previewUrl ? (
            <img src={previewUrl} alt="" style={{
              maxWidth: '100%', maxHeight: 160, display: 'block', margin: '0 auto',
              imageRendering: 'auto',
            }} />
          ) : (
            <div style={{ fontSize: 10, color: '#888', textAlign: 'center', padding: '20px 0' }}>
              Loading…
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
