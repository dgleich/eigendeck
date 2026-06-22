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
import { HelpText } from './HelpText';
import { invalidateRenderedAsset } from '../lib/assetRenderer';
import { storeAssetRaw } from '../lib/assetInsert';
import { dirname, resolvePosixPath } from '../lib/watcherRegistry';
import { effectiveAutoReload, usePreference } from '../lib/preferences';
import { computeAssetUsage } from '../lib/assetUsage';
import { useAssetMissing, markAssetMissing, markAssetFound } from '../lib/missingAssets';

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

/** Strip the `-NNNNNNNN` monotonic counter suffix that storage's
 *  `chrono_lite_now()` appends after the ISO Z. JavaScript's Date
 *  doesn't parse that and silently returns NaN; without this strip
 *  the entire version-history list renders blank. */
function parseTimestamp(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const stripped = iso.replace(/-\d{8}$/, '');
  const d = new Date(stripped);
  return isNaN(d.getTime()) ? null : d;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseTimestamp(iso);
  if (!d) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function relativeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseTimestamp(iso);
  if (!d) return '';
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

export function AssetSection({ assetId, elementId }: { assetId: string; elementId?: string }) {
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [history, setHistory] = useState<AssetVersion[]>([]);
  const [reloading, setReloading] = useState(false);
  const isMissing = useAssetMissing(assetId);
  const [globalAutoReload] = usePreference('autoReloadAssets');
  const presOverride = usePresentationStore((s) => s.presentation?.config?.autoReloadAssets ?? null);

  const fetchMeta = useCallback(async () => {
    const m = await invoke<AssetMeta | null>('db_get_asset_meta_by_id', { assetId }).catch(() => null);
    setMeta(m);
    if (m) {
      const hist = await invoke<AssetVersion[]>('db_get_asset_history', { assetId: m.asset_id })
        .catch(() => []);
      setHistory(hist);
    } else {
      setHistory([]);
    }
  }, [assetId]);

  useEffect(() => { void fetchMeta(); }, [fetchMeta]);

  // Refetch on asset-changed (watcher reloads, restore, manual reload).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) void fetchMeta();
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId, fetchMeta]);

  const reloadNow = useCallback(async () => {
    if (!meta?.external_path || !projectPath) return;
    setReloading(true);
    try {
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      const absPath = resolvePosixPath(dirname(projectPath), meta.external_path);
      const bytes = await readFile(absPath);
      const st = await stat(absPath).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      await storeAssetRaw({
        path: meta.path ?? '',
        mimeType: meta.mime_type ?? 'application/octet-stream',
        externalPath: meta.external_path,
        externalMtime: mtime,
        assetId: meta.asset_id,
        autoReload: null,
      }, bytes);
      await invalidateRenderedAsset(meta.asset_id);
      markAssetFound(meta.asset_id);  // read succeeded — source is back (#74)
    } catch (e) {
      console.warn('[AssetSection] reload failed:', e);
      markAssetMissing(meta.asset_id, meta.path ?? meta.external_path);  // #74
    } finally {
      setReloading(false);
    }
  }, [meta, projectPath]);

  /** Relocate (#74): point a missing asset at a new file on disk. Reads the
   *  chosen file, re-stores it under the same asset_id with the new absolute
   *  path as external_path (resolvePosixPath passes absolute paths through, so
   *  watching resumes), then clears the missing flag. */
  const relocate = useCallback(async () => {
    if (!meta || !projectPath) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ title: 'Locate source file', multiple: false, directory: false });
    if (!picked || typeof picked !== 'string') return;
    setReloading(true);
    try {
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(picked);
      const st = await stat(picked).catch(() => null);
      const mtime = st?.mtime ? st.mtime.toISOString() : null;
      await storeAssetRaw({
        path: meta.path ?? '',
        mimeType: meta.mime_type ?? 'application/octet-stream',
        externalPath: picked,            // absolute — resolvePosixPath returns as-is
        externalMtime: mtime,
        assetId: meta.asset_id,
        autoReload: null,
      }, bytes);
      await invalidateRenderedAsset(meta.asset_id);
      markAssetFound(meta.asset_id);
      window.dispatchEvent(new CustomEvent('eigendeck:asset-changed', { detail: { assetId: meta.asset_id } }));
      // If a whole folder moved, this one relocate reveals where — apply the
      // same directory offset to the other missing assets (#74).
      const projectDir = dirname(projectPath);
      const oldAbs = resolvePosixPath(projectDir, meta.external_path!);
      const { relocateMissingByOffset } = await import('../lib/watcherRegistry');
      const r = await relocateMissingByOffset(projectDir, meta.asset_id, oldAbs, picked);
      if (r.relocated > 0) {
        const { showToast } = await import('../lib/toasts');
        showToast({
          message: `Relocated ${r.relocated} more file${r.relocated === 1 ? '' : 's'} in the same folder.`,
          kind: 'success',
        });
      }
    } catch (e) {
      console.warn('[AssetSection] relocate failed:', e);
    } finally {
      setReloading(false);
    }
  }, [meta, projectPath]);

  /** "Resize to asset" — tighten the element's bounding box around the
   *  currently-rendered image so the box matches the asset's natural
   *  dimensions (within the current zoom). Keeps the rendered image
   *  exactly where it is on the slide — only the selectable rectangle
   *  changes.
   *
   *  Math: <img> uses object-fit: contain (see ImageBox in
   *  SlideElementRenderer). The rendered region is the asset scaled
   *  to fit the box, centered. After resize: new box = that rendered
   *  region exactly. */
  const resizeToAsset = useCallback(async () => {
    if (!meta || !elementId) return;
    const pres = usePresentationStore.getState().presentation;
    if (!pres) return;
    let elPos: { x: number; y: number; width: number; height: number } | null = null;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.id === elementId) {
          elPos = { ...el.position };
          break;
        }
      }
      if (elPos) break;
    }
    if (!elPos) return;

    // Load asset bytes into an Image to measure natural dimensions.
    // Works for SVG (browser parses viewBox) and raster alike.
    try {
      const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: meta.asset_id });
      const blob = new Blob([new Uint8Array(data)], { type: meta.mime_type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('image load failed'));
          i.src = url;
        });
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        if (!natW || !natH) {
          console.warn('[AssetSection] resize-to-asset: no natural dimensions on image');
          return;
        }
        // object-fit: contain layout inside the current box.
        const scale = Math.min(elPos.width / natW, elPos.height / natH);
        const renderedW = natW * scale;
        const renderedH = natH * scale;
        const renderedX = elPos.x + (elPos.width - renderedW) / 2;
        const renderedY = elPos.y + (elPos.height - renderedH) / 2;
        usePresentationStore.getState().updateElement(elementId, {
          position: { x: renderedX, y: renderedY, width: renderedW, height: renderedH },
        } as any);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn('[AssetSection] resize-to-asset failed:', e);
    }
  }, [meta, elementId]);

  // How many current elements reference this asset, across how many
  // distinct slides. Reactive: re-runs when the presentation changes.
  // Shown in the UI as "Used N times across M slides" and used to
  // phrase Restore's confirm dialog. usageCount is the element count
  // (the actual blast radius — every copy changes); slideCount is for
  // the user-facing label only.
  //
  // Two separate primitive-returning selectors that each delegate to
  // the pure computeAssetUsage helper. NOT one selector returning an
  // object — Zustand defaults to Object.is for equality; a fresh
  // object literal on every store change would never equal the
  // previous, triggering an infinite render loop. Crashed the app on
  // Inspector open until this was split.
  const usageCount = usePresentationStore((s) =>
    meta ? computeAssetUsage(s.presentation, meta.asset_id).elementCount : 0);
  const slideCount = usePresentationStore((s) =>
    meta ? computeAssetUsage(s.presentation, meta.asset_id).slideCount : 0);

  // Per-asset auto-reload is now a simple 2-state ('off' | null) — no
  // fork-on-shared, no per-element semantics. The whole asset stops or
  // resumes being watched; all bound elements are affected equally,
  // and the UI tells the user that via the "Used on N slides" caption.
  //
  // Fires the `eigendeck:asset-changed` event after the DB write so
  // useAssetFileWatcher re-evaluates the cascade and subscribes /
  // unsubscribes accordingly. Without this, the hook's existing
  // subscription persists across the auto_reload flip — file mutation
  // would still trigger an update even though the user just opted out.
  const setAutoReload = useCallback(async (value: 'off' | null) => {
    if (!meta) return;
    await invoke('db_set_asset_auto_reload', { assetId: meta.asset_id, value }).catch(() => {});
    window.dispatchEvent(new CustomEvent('eigendeck:asset-changed', {
      detail: { assetId: meta.asset_id },
    }));
    await fetchMeta();
  }, [meta, fetchMeta]);

  // Restore writes a new asset row with the old bytes (db_restore_asset_
  // version handles auto_reload='off' on the new row to prevent the
  // watcher from immediately re-clobbering). Affects every element bound
  // to this asset. Confirm only when N > 1; solo asset restores
  // directly since no action-at-a-distance is possible.
  const restoreVersion = useCallback(async (valid_from: string) => {
    if (!meta) return;
    const when = relativeAgo(valid_from) || valid_from;
    if (usageCount > 1) {
      const labelPath = meta.path ?? '(unnamed asset)';
      const fileName = labelPath.split('/').pop() ?? labelPath;
      const where = slideCount === 1
        ? 'on this slide'
        : `across ${slideCount} slides`;
      const ok = confirm(
        `Restore ${fileName} to the version from ${when}? This will affect all ${usageCount} copies of this image ${where}.`,
      );
      if (!ok) return;
    }
    await invoke('db_restore_asset_version', { assetId: meta.asset_id, validFrom: valid_from }).catch((e) => {
      console.warn('[AssetSection] restore failed:', e);
    });
    await invalidateRenderedAsset(meta.asset_id);
  }, [meta, usageCount, slideCount]);

  if (!meta) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#999' }}>
        Not yet stored — drag the file in or save the project to enable asset tracking.
      </div>
    );
  }

  // Effective watch behavior for this asset under the new downward-only
  // cascade. Display tells the user the result; the checkbox below is
  // the per-asset opt-out (the only knob this UI offers).
  const effective = effectiveAutoReload(meta.auto_reload, presOverride, globalAutoReload);
  const optedOut = meta.auto_reload === 'off';
  // Why the asset isn't being watched, if it isn't. Used for the caption
  // under the checkbox so the user knows where the off came from.
  const cascadeBlock: 'global' | 'presentation' | 'asset' | null =
    !globalAutoReload ? 'global'
    : presOverride === 'off' ? 'presentation'
    : optedOut ? 'asset'
    : null;
  // Phrasing variations cover the 4 layout cases honestly:
  //   1 copy, 1 slide  → "Used on this slide only"
  //   N copies, 1 slide → "Used N times on this slide"
  //   1 copy each, M slides → "Used on M slides"
  //   N copies, M slides (mixed) → "Used N times across M slides"
  const usageLabel
    = usageCount <= 1 ? 'Used on this slide only'
    : slideCount === 1 ? `Used ${usageCount} times on this slide`
    : usageCount === slideCount ? `Used on ${slideCount} slides`
    : `Used ${usageCount} times across ${slideCount} slides`;

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Where the asset is linked from on disk (what file-watch / reload
          tracks). The internal storage path is a dev detail and not shown. */}
      <div style={{ fontSize: 11 }}>
        <div style={{ color: '#666', marginBottom: 2 }}>Source file</div>
        {meta.external_path ? (
          <>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: '#222' }}>{meta.external_path}</div>
            {meta.external_mtime && (
              <div style={{ color: '#888', marginTop: 2 }}>last loaded: {fmtTime(meta.external_mtime)}</div>
            )}
          </>
        ) : (
          <div style={{ color: '#999' }}>Embedded snapshot — no linked source file</div>
        )}
      </div>

      {/* Missing-source alert (#74): the linked file is gone from disk. The
          last-loaded snapshot is still shown, so nothing is lost — but offer a
          Relocate so the user can re-point the link to the file's new home. */}
      {isMissing && meta.external_path && projectPath && (
        <div style={{
          fontSize: 11, padding: '6px 8px',
          background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 3, color: '#991b1b',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span>
            ⚠ Source file is missing from disk. Showing the last-loaded snapshot —
            edits to the original won't appear until you relocate it.
          </span>
          <button
            onClick={relocate}
            disabled={reloading}
            style={{
              alignSelf: 'flex-start', padding: '3px 10px', fontSize: 11,
              background: '#dc2626', color: '#fff',
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}>
            Relocate…
          </button>
        </div>
      )}

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

      {/* Usage scope caption — always visible so the user knows the
          blast radius of any action below (Restore, Watch toggle,
          Reload). The bug log calls this out as the key UX fix for
          asset-scoped controls in element-scoped UI. */}
      <div style={{ fontSize: 11, color: '#6b7280' }}>{usageLabel}</div>

      {/* Per-asset 2-state Watch toggle — only meaningful when the
          asset has a source file AND the project has a dir to resolve
          it against. */}
      {meta.external_path && projectPath && (
        <div style={{ fontSize: 11 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: cascadeBlock && cascadeBlock !== 'asset' ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={effective}
              disabled={cascadeBlock !== null && cascadeBlock !== 'asset'}
              onChange={(e) => setAutoReload(e.target.checked ? null : 'off')}
              style={{ marginTop: 2 }} />
            <span>Watch this file for changes</span>
          </label>
          <HelpText style={{ fontSize: 10, marginTop: 4, marginLeft: 22 }}>
            {cascadeBlock === 'global' && (
              <>Disabled because the global setting (Cmd+,) is off.</>
            )}
            {cascadeBlock === 'presentation' && (
              <>Disabled because watching is turned off for this presentation.</>
            )}
            {cascadeBlock === 'asset' && (
              usageCount > 1
                ? <>Off: file changes don't update any of the {usageCount} copies.</>
                : <>Off: file changes don't update this image.</>
            )}
            {cascadeBlock === null && (
              usageCount > 1
                ? <>On: file changes update all {usageCount} copies of this image.</>
                : <>On: file changes update this image.</>
            )}
          </HelpText>
        </div>
      )}

      {/* Actions row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {meta.external_path && projectPath && (
          <button onClick={reloadNow} disabled={reloading}
            style={{
              padding: '4px 10px', fontSize: 12,
              border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer',
              background: reloading ? '#eee' : '#fff',
            }}>
            {reloading ? 'Reloading…' : 'Reload from disk now'}
          </button>
        )}
        {/* "Resize to image" only makes sense for raster / SVG assets
            with measurable natural dimensions. Demos (text/html) and
            PDFs don't have a single intrinsic display size you'd
            snap the element box to. */}
        {elementId && (meta.mime_type ?? '').startsWith('image/') && (
          <button onClick={() => { void resizeToAsset(); }}
            title="Resize the bounding box to wrap the image exactly. The image stays in place."
            style={{
              padding: '4px 10px', fontSize: 12,
              border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer',
              background: '#fff',
            }}>
            Resize to image
          </button>
        )}
      </div>

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
              mimeType={meta.mime_type} path={meta.path ?? ''}
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
