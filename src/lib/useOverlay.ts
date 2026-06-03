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
  const [overlay, setOverlay] = useState<Overlay>(() => emptyOverlay());
  // The overlay asset's id once known (loaded or created). null until
  // the first flush creates it.
  const assetIdRef = useRef<string | null>(null);
  // Last-flushed serialized bytes, to skip no-op flushes.
  const lastFlushedRef = useRef<string>('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest overlay for the debounced flush closure.
  const overlayRef = useRef<Overlay>(overlay);
  overlayRef.current = overlay;

  // --- load on mount / element change -------------------------------
  useEffect(() => {
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
    const current = overlayRef.current;
    const bytes = serializeOverlay(current);
    if (bytes === lastFlushedRef.current) return;       // no-op guard
    try {
      // Lazily create with an explicit UUID so two empty overlays
      // never hash-collapse onto one asset (blocker B3). Reuse the
      // existing id on subsequent flushes (new temporal version).
      const id = assetIdRef.current ?? crypto.randomUUID();
      assetIdRef.current = id;
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
  const recordOutput = useCallback((index: number, outputs: CellOutput[], executionCount: number | null) => {
    setOverlay((prev) => ({
      ...prev,
      cellOutputs: { ...prev.cellOutputs, [index]: outputs },
      cellCounts: { ...prev.cellCounts, [index]: executionCount },
    }));
  }, []);

  const setEdit = useCallback((index: number, source: string, savedSource: string) => {
    setOverlay((prev) => {
      const edits = { ...prev.cellEdits };
      if (source === savedSource) delete edits[index];
      else edits[index] = source;
      return { ...prev, cellEdits: edits };
    });
  }, []);

  const revertEdit = useCallback((index: number) => {
    setOverlay((prev) => {
      if (!(index in prev.cellEdits)) return prev;
      const edits = { ...prev.cellEdits };
      delete edits[index];
      return { ...prev, cellEdits: edits };
    });
  }, []);

  const setAppendedSource = useCallback((id: string, source: string) => {
    setOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.map((a) => a.id === id ? { ...a, source } : a),
    }));
  }, []);

  const recordAppendedOutput = useCallback((id: string, outputs: CellOutput[], executionCount: number | null) => {
    setOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.map((a) =>
        a.id === id ? { ...a, outputs, executionCount } : a),
    }));
  }, []);

  const addAppended = useCallback((afterIndex: number | null, cellType: 'code' | 'markdown') => {
    const cell: AppendedCell = { id: crypto.randomUUID(), afterIndex, cellType, source: '' };
    setOverlay((prev) => ({ ...prev, appendedCells: [...prev.appendedCells, cell] }));
    return cell;
  }, []);

  const removeAppended = useCallback((id: string) => {
    setOverlay((prev) => ({
      ...prev,
      appendedCells: prev.appendedCells.filter((a) => a.id !== id),
    }));
  }, []);

  const clear = useCallback(() => {
    setOverlay(emptyOverlay());
  }, []);

  return {
    overlay,
    recordOutput, setEdit, revertEdit,
    setAppendedSource, recordAppendedOutput, addAppended, removeAppended,
    clear,
  };
}
