// React hook owning a notebook element's "overlay" — the eigendeck
// record of the live session (source edits, recorded outputs,
// live-authored cells) stored as an owner-tagged asset
// (assets.owner_element_id = the element id). See
// .claude/notes/notebook-recording-decisions.md.
//
// Responsibilities:
//   - load the overlay on mount (db_get_owned_asset_id → bytes → parse)
//   - hold it in memory; expose record/edit/revert/append mutators
//   - flush to a new overlay-asset version, debounced + only-when-changed
//   - lazily CREATE the overlay asset on first flush with an explicit
//     client-minted UUID (so hash-dedup can't collapse two empty
//     overlays — blocker B3)
//
// The .ipynb asset is never touched here. "Recorder, not editor."

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Overlay, emptyOverlay, parseOverlay, serializeOverlay, OVERLAY_MIME,
  AppendedCell,
} from './notebookOverlay';
import { CellOutput } from './notebookFormat';

const FLUSH_DEBOUNCE_MS = 800;

// Module-level in-session cache of overlays, keyed by element id. The
// editor and PresentMode mount SEPARATE NotebookContent instances
// (App returns <PresentMode/> instead of the editor while presenting),
// so a per-instance overlay would lose state across the present↔edit
// transition — and a DB reload on remount races the outgoing flush.
// This cache is the in-session source of truth: any instance's
// mutations land here, and a remounted instance reads it synchronously
// (no flicker, no race). The asset is still flushed for durability.
// Cleared per-element on reload-from-disk and wholesale on deck load.
const overlayCache = new Map<string, Overlay>();

/** Drop all cached overlays — call on deck open/close so element ids
 *  from a previous deck don't leak. */
export function clearAllOverlayCache(): void {
  overlayCache.clear();
}

export interface UseOverlayResult {
  overlay: Overlay;
  /** Replace a cell's recorded output + execution count (by .ipynb index). */
  recordOutput(index: number, outputs: CellOutput[], executionCount: number | null): void;
  /** Set/replace a cell's source edit (by .ipynb index). Passing the
   *  cell's saved source clears the edit. */
  setEdit(index: number, source: string, savedSource: string): void;
  /** Drop a cell's source edit. */
  revertEdit(index: number): void;
  /** Replace an appended cell's source. */
  setAppendedSource(id: string, source: string): void;
  /** Replace an appended cell's recorded output. */
  recordAppendedOutput(id: string, outputs: CellOutput[], executionCount: number | null): void;
  /** Add a live-authored cell after the given .ipynb index (null = top). */
  addAppended(afterIndex: number | null, cellType: 'code' | 'markdown'): AppendedCell;
  /** Remove an appended cell by id. */
  removeAppended(id: string): void;
  /** Drop the entire overlay (e.g. after a manual reload-from-disk). */
  clear(): void;
}

export function useOverlay(elementId: string): UseOverlayResult {
  // Seed from the in-session cache so a remount (e.g. exiting
  // PresentMode) shows recorded outputs immediately.
  const [overlay, setOverlay] = useState<Overlay>(() => overlayCache.get(elementId) ?? emptyOverlay());
  // The overlay asset's id once known (loaded or created). null until
  // the first flush creates it.
  const assetIdRef = useRef<string | null>(null);
  // Last-flushed serialized bytes, to skip no-op flushes. Seeded with the
  // initial overlay's bytes so an UNTOUCHED overlay never flushes (a ''
  // seed let a flush racing the load write an empty overlay — one source
  // of the duplicate-asset bug).
  const lastFlushedRef = useRef<string>(
    serializeOverlay(overlayCache.get(elementId) ?? emptyOverlay()),
  );
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest overlay for the debounced flush closure.
  const overlayRef = useRef<Overlay>(overlay);
  overlayRef.current = overlay;

  // --- load on mount / element change -------------------------------
  useEffect(() => {
    // If this element's overlay is already cached this session, trust
    // it (it holds in-flight edits/outputs that may not be flushed yet)
    // and skip the DB load — avoids the present→edit reload race.
    if (overlayCache.has(elementId)) {
      const cached = overlayCache.get(elementId)!;
      // We don't know the asset id from the cache alone; fetch it lazily
      // (cheap) so a subsequent flush updates the existing asset rather
      // than minting a second one.
      if (assetIdRef.current === null) {
        void invoke<string | null>('db_get_owned_asset_id', { ownerElementId: elementId })
          .then((id) => { if (id) assetIdRef.current = id; })
          .catch(() => {});
      }
      lastFlushedRef.current = serializeOverlay(cached);
      setOverlay(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const id = await invoke<string | null>('db_get_owned_asset_id', {
          ownerElementId: elementId,
        });
        if (cancelled) return;
        if (id) {
          assetIdRef.current = id;
          const buf = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: id });
          if (cancelled) return;
          const parsed = parseOverlay(new Uint8Array(buf));
          lastFlushedRef.current = serializeOverlay(parsed);
          overlayCache.set(elementId, parsed);
          setOverlay(parsed);
        } else {
          assetIdRef.current = null;
          lastFlushedRef.current = serializeOverlay(emptyOverlay());
          setOverlay(emptyOverlay());
        }
      } catch (e) {
        console.warn('useOverlay load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [elementId]);

  // --- flush (debounced, only-when-changed) -------------------------
  const flushNow = useCallback(async () => {
    // Flush the SHARED cache — it's the source of truth across remounts and
    // the present<->edit transition. Serializing per-instance state here let
    // a stale/empty instance overwrite a richer overlay. Fall back to the
    // live overlay if the cache was cleared (reload-from-disk).
    const current = overlayCache.get(elementId) ?? overlayRef.current;
    const bytes = serializeOverlay(current);
    if (bytes === lastFlushedRef.current) return;       // nothing changed

    // Resolve the asset id WITHOUT minting a fresh random one per flush —
    // that created a new overlay asset on every remount, and the loader
    // (db_get_owned_asset_id, latest-first) could then pick an empty
    // duplicate. Reuse this element's existing owned overlay if any;
    // otherwise use a DETERMINISTIC id so concurrent/remount first-flushes
    // all converge on ONE asset (also subsumes the old anti-hash-collapse
    // trick — B3). Never create an asset for an empty overlay.
    let id = assetIdRef.current;
    if (id == null) {
      if (bytes === serializeOverlay(emptyOverlay())) {
        lastFlushedRef.current = bytes;                  // nothing to persist
        return;
      }
      try {
        id = await invoke<string | null>('db_get_owned_asset_id', {
          ownerElementId: elementId,
        });
      } catch { id = null; }
      id = id ?? `overlay-${elementId}`;
      assetIdRef.current = id;
    }
    try {
      const data = Array.from(new TextEncoder().encode(bytes));
      await invoke('db_store_asset', {
        path: `overlay:${elementId}`,
        data,
        mimeType: OVERLAY_MIME,
        externalPath: null,
        externalMtime: null,
        assetId: id,
        autoReload: 'off',
        ownerElementId: elementId,
      });
      lastFlushedRef.current = bytes;
    } catch (e) {
      console.warn('useOverlay flush failed:', e);
    }
  }, [elementId]);

  // Schedule a debounced flush whenever the overlay changes.
  useEffect(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void flushNow(); }, FLUSH_DEBOUNCE_MS);
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, [overlay, flushNow]);

  // Flush any pending change on unmount (best-effort).
  useEffect(() => {
    return () => { void flushNow(); };
  }, [flushNow]);

  // --- mutators -----------------------------------------------------
  // All mutations go through applyOverlay so the in-session cache stays
  // in lock-step with component state — that's what survives the
  // present↔edit remount.
  const applyOverlay = useCallback((updater: (o: Overlay) => Overlay) => {
    setOverlay((prev) => {
      const next = updater(prev);
      overlayCache.set(elementId, next);
      return next;
    });
  }, [elementId]);

  const recordOutput = useCallback((index: number, outputs: CellOutput[], executionCount: number | null) => {
    applyOverlay((prev) => ({
      ...prev,
      cellOutputs: { ...prev.cellOutputs, [index]: outputs },
      cellCounts: { ...prev.cellCounts, [index]: executionCount },
    }));
  }, [applyOverlay]);

  const setEdit = useCallback((index: number, source: string, savedSource: string) => {
    applyOverlay((prev) => {
      const edits = { ...prev.cellEdits };
      if (source === savedSource) delete edits[index];
      else edits[index] = source;
      return { ...prev, cellEdits: edits };
    });
  }, [applyOverlay]);

  const revertEdit = useCallback((index: number) => {
    applyOverlay((prev) => {
      if (!(index in prev.cellEdits)) return prev;
      const edits = { ...prev.cellEdits };
      delete edits[index];
      return { ...prev, cellEdits: edits };
    });
  }, [applyOverlay]);

  const setAppendedSource = useCallback((id: string, source: string) => {
    applyOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.map((a) => a.id === id ? { ...a, source } : a),
    }));
  }, [applyOverlay]);

  const recordAppendedOutput = useCallback((id: string, outputs: CellOutput[], executionCount: number | null) => {
    applyOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.map((a) =>
        a.id === id ? { ...a, outputs, executionCount } : a),
    }));
  }, [applyOverlay]);

  const addAppended = useCallback((afterIndex: number | null, cellType: 'code' | 'markdown') => {
    const cell: AppendedCell = { id: crypto.randomUUID(), afterIndex, cellType, source: '' };
    applyOverlay((prev) => ({ ...prev, appendedCells: [...prev.appendedCells, cell] }));
    return cell;
  }, [applyOverlay]);

  const removeAppended = useCallback((id: string) => {
    applyOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.filter((a) => a.id !== id),
    }));
  }, [applyOverlay]);

  const clear = useCallback(() => {
    overlayCache.delete(elementId);
    setOverlay(emptyOverlay());
  }, [elementId]);

  return {
    overlay,
    recordOutput, setEdit, revertEdit,
    setAppendedSource, recordAppendedOutput, addAppended, removeAppended,
    clear,
  };
}
