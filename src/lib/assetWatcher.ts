// File-system watcher for linked assets.
//
// When an image is inserted via drag-drop or the file picker, we store
// the source file's path-relative-to-eigendeck-dir in
// assets.external_path. This hook resolves that back to an absolute
// path at runtime, registers a plugin-fs watch on it, and on any change
// re-reads the file → updates the stored bytes → fires
// invalidateRenderedAsset so the rendered thumbnail / canvas updates
// in place.
//
// Workflow it enables:
//   open Inkscape → edit SVG → ⌘S → slide updates in ~100 ms
//
// Out of scope (v1):
//   - HTTP/remote source links
//   - Demo HTML watching (we store demos but don't watch them yet)
//   - Manual unwatch / explicit re-link UI (would live in Inspector)

import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { invalidateRenderedAsset } from './assetRenderer';

/**
 * POSIX-style: join an absolute dir with a possibly-../-prefixed relative
 * path. (Mac is POSIX; not used on Windows.)
 */
function resolvePosixPath(absDir: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const parts = (absDir + '/' + rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return '/' + out.join('/');
}

function dirname(absPath: string): string {
  const i = absPath.lastIndexOf('/');
  return i <= 0 ? '/' : absPath.substring(0, i);
}

/**
 * Watch the source file behind an asset (if any) and auto-reload the
 * stored bytes when it changes on disk. No-op when:
 *   - the asset has no external_path (e.g. pasted from clipboard, or
 *     embedded as snapshot)
 *   - the presentation isn't saved yet (no project dir to resolve against)
 *
 * Idempotent across re-mounts; safely unwatches on unmount or input change.
 */
export function useAssetFileWatcher(assetPath: string | undefined, mimeType: string): void {
  const projectPath = usePresentationStore((s) => s.projectPath);

  useEffect(() => {
    if (!assetPath || !projectPath) return;
    let cancelled = false;
    let unwatch: (() => void) | undefined;

    (async () => {
      const externalRel = await invoke<string | null>('db_get_asset_external_path', { path: assetPath })
        .catch(() => null);
      if (!externalRel || cancelled) return;

      const projectDir = dirname(projectPath);
      const absPath = resolvePosixPath(projectDir, externalRel);

      try {
        const { watch } = await import('@tauri-apps/plugin-fs');
        // plugin-fs `watch` returns an UnlistenFn; the callback fires on
        // any kind of change to the path. We don't differentiate event
        // types — a single reload-on-change is the right policy.
        unwatch = await watch(absPath, async () => {
          if (cancelled) return;
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(absPath);
            // Re-store with the same externalPath so the link stays
            // intact across reloads. db_store_asset is INSERT OR REPLACE.
            await invoke('db_store_asset', {
              path: assetPath,
              data: Array.from(bytes),
              mimeType,
              externalPath: externalRel,
              externalMtime: null,
            });
            await invalidateRenderedAsset(assetPath);
          } catch (e) {
            // Source moved / deleted / momentary tool-rewrite collision —
            // most editors do atomic-rename which can briefly look like
            // a missing file. Ignore; next event will retry.
            console.warn(`[assetWatcher] reload ${assetPath} failed:`, e);
          }
        }, { delayMs: 100 });  // small coalescing window for editor-save sequences
      } catch (e) {
        // watch() can fail (path doesn't exist, no permission, etc.).
        // Not fatal — the asset just won't auto-update.
        console.warn(`[assetWatcher] watch ${absPath} failed:`, e);
      }
    })();

    return () => {
      cancelled = true;
      if (unwatch) unwatch();
    };
  }, [assetPath, mimeType, projectPath]);
}
