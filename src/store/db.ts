/**
 * SQLite-backed store for Eigendeck.
 *
 * Replaces the Zustand store. All reads/writes go through Tauri invoke().
 * React hooks trigger re-fetches via a simple event bus.
 *
 * Usage:
 *   const slides = useSlides();
 *   const elements = useSlideElements(slideId);
 *   await dbUpdateElement(id, data);
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Slide, SlideElement, Presentation, PresentationConfig } from '../types/presentation';

// ============================================================================
// Event bus: notify React hooks when data changes
// ============================================================================
type DbEvent =
  | 'slides-changed'
  | 'elements-changed'
  | 'presentation-changed'
  | `slide-elements-changed:${string}`;

const listeners = new Map<string, Set<() => void>>();

function emit(event: DbEvent) {
  listeners.get(event)?.forEach((fn) => fn());
  // Also emit a wildcard for components that watch everything
  listeners.get('*')?.forEach((fn) => fn());
}

function subscribe(event: DbEvent | '*', fn: () => void): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => { listeners.get(event)?.delete(fn); };
}

// ============================================================================
// App state (non-DB state that doesn't belong in SQLite)
// ============================================================================
let _currentSlideIndex = 0;
let _isPresenting = false;
let _showProperties = false;
let _projectPath: string | null = null;
let _selectedObject: SelectedObject = { type: 'slide' };

export type SelectedObject =
  | { type: 'slide' }
  | { type: 'element'; id: string }
  | { type: 'multi'; ids: string[] }
  | null;

const uiListeners = new Set<() => void>();
function emitUI() { uiListeners.forEach((fn) => fn()); }

export function useUIState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    uiListeners.add(fn);
    return () => { uiListeners.delete(fn); };
  }, []);

  return {
    currentSlideIndex: _currentSlideIndex,
    isPresenting: _isPresenting,
    showProperties: _showProperties,
    projectPath: _projectPath,
    selectedObject: _selectedObject,
  };
}

export function setCurrentSlideIndex(i: number) { _currentSlideIndex = i; emitUI(); }
export function setPresenting(v: boolean) { _isPresenting = v; emitUI(); }
export function toggleProperties() { _showProperties = !_showProperties; emitUI(); }
export function setProjectPath(p: string | null) { _projectPath = p; emitUI(); }
export function selectObject(obj: SelectedObject) { _selectedObject = obj; emitUI(); }

export function toggleSelectElement(id: string) {
  const sel = _selectedObject;
  if (!sel || sel.type === 'slide') {
    _selectedObject = { type: 'element', id };
  } else if (sel.type === 'element') {
    if (sel.id === id) _selectedObject = { type: 'slide' };
    else _selectedObject = { type: 'multi', ids: [sel.id, id] };
  } else if (sel.type === 'multi') {
    const ids = sel.ids.includes(id) ? sel.ids.filter((i) => i !== id) : [...sel.ids, id];
    if (ids.length === 0) _selectedObject = { type: 'slide' };
    else if (ids.length === 1) _selectedObject = { type: 'element', id: ids[0] };
    else _selectedObject = { type: 'multi', ids };
  }
  emitUI();
}

// ============================================================================
// Database lifecycle
// ============================================================================

export async function dbOpen(path: string): Promise<void> {
  await invoke('db_open', { path });
  _projectPath = path;
  emit('presentation-changed');
  emit('slides-changed');
  emitUI();
}

export async function dbClose(): Promise<void> {
  await invoke('db_close');
  _projectPath = null;
  emitUI();
}

export async function dbImportJson(presentation: Presentation): Promise<void> {
  await invoke('db_import_json', { json: JSON.stringify(presentation) });
  emit('presentation-changed');
  emit('slides-changed');
}

export async function dbExportJson(): Promise<Presentation> {
  const json = await invoke<string>('db_export_json');
  return JSON.parse(json);
}

// ============================================================================
// Read hooks
// ============================================================================

/** All slides (metadata only). Re-fetches when slides change. */
export function useSlides(): Slide[] {
  const [slides, setSlides] = useState<Slide[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const json = await invoke<string>('db_get_slides');
        if (mounted) setSlides(JSON.parse(json));
      } catch (e) {
        console.error('Failed to load slides:', e);
      }
    };
    load();
    const unsub = subscribe('slides-changed', load);
    return () => { mounted = false; unsub(); };
  }, []);

  return slides;
}

/** Elements for a specific slide. Re-fetches when that slide's elements change. */
export function useSlideElements(slideId: string | null): SlideElement[] {
  const [elements, setElements] = useState<SlideElement[]>([]);

  useEffect(() => {
    if (!slideId) { setElements([]); return; }
    let mounted = true;
    const load = async () => {
      try {
        const json = await invoke<string>('db_get_slide_elements', { slideId });
        if (mounted) setElements(JSON.parse(json));
      } catch (e) {
        console.error('Failed to load elements:', e);
      }
    };
    load();
    const unsub1 = subscribe(`slide-elements-changed:${slideId}`, load);
    const unsub2 = subscribe('elements-changed', load);
    return () => { mounted = false; unsub1(); unsub2(); };
  }, [slideId]);

  return elements;
}

/** Presentation config. */
export function usePresentationConfig(): { title: string; config: PresentationConfig } | null {
  const [data, setData] = useState<{ title: string; config: PresentationConfig } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const json = await invoke<string>('db_export_json');
        const p = JSON.parse(json);
        if (mounted) setData({ title: p.title, config: p.config });
      } catch {
        // DB not open yet
      }
    };
    load();
    const unsub = subscribe('presentation-changed', load);
    return () => { mounted = false; unsub(); };
  }, []);

  return data;
}

// ============================================================================
// Write operations
// ============================================================================

export async function dbUpdateElement(
  id: string,
  data: Record<string, unknown>,
  linkId?: string | null
): Promise<void> {
  await invoke('db_update_element', {
    id,
    data: JSON.stringify(data),
    linkId: linkId ?? null,
  });
  emit('elements-changed');
}

export async function dbAddElement(
  slideId: string,
  element: SlideElement,
  zOrder: number
): Promise<void> {
  const { linkId, ...rest } = element as any;
  await invoke('db_add_element', {
    slideId,
    elementId: element.id,
    elementType: element.type,
    data: JSON.stringify(rest),
    linkId: linkId ?? null,
    zOrder,
  });
  emit(`slide-elements-changed:${slideId}`);
  emit('elements-changed');
}

export async function dbRemoveElementFromSlide(
  slideId: string,
  elementId: string
): Promise<void> {
  await invoke('db_remove_element_from_slide', { slideId, elementId });
  emit(`slide-elements-changed:${slideId}`);
}

export async function dbCompact(deleteAll: boolean = false): Promise<{ beforeBytes: number; afterBytes: number; savedBytes: number }> {
  const json = await invoke<string>('db_compact', { keepAll: deleteAll });
  return JSON.parse(json);
}

// ============================================================================
// Slide operations
// ============================================================================

export async function dbAddSlide(
  id: string,
  position: number,
  layout: string = 'default',
  groupId?: string | null
): Promise<void> {
  await invoke('db_add_slide', { id, position, layout, groupId: groupId ?? null });
  emit('slides-changed');
}

export async function dbDeleteSlide(slideId: string): Promise<void> {
  await invoke('db_delete_slide', { slideId });
  emit('slides-changed');
}

export async function dbDuplicateSlide(
  sourceSlideId: string,
  newSlideId: string,
  newPosition: number,
  groupId?: string | null
): Promise<void> {
  await invoke('db_duplicate_slide', {
    sourceSlideId,
    newSlideId,
    newPosition,
    groupId: groupId ?? null,
  });
  emit('slides-changed');
}

export async function dbMoveSlide(slideId: string, newPosition: number): Promise<void> {
  await invoke('db_move_slide', { slideId, newPosition });
  emit('slides-changed');
}

export async function dbUpdateSlide(
  slideId: string,
  changes: { layout?: string; notes?: string; groupId?: string | null }
): Promise<void> {
  await invoke('db_update_slide', {
    slideId,
    layout: changes.layout ?? null,
    notes: changes.notes ?? null,
    groupId: changes.groupId ?? null,
  });
  emit('slides-changed');
}

export async function dbUpdateZOrder(
  slideId: string,
  elementId: string,
  newZOrder: number
): Promise<void> {
  await invoke('db_update_z_order', { slideId, elementId, newZOrder });
  emit(`slide-elements-changed:${slideId}`);
}

export async function dbFreeElement(
  slideId: string,
  elementId: string,
  newElementId: string,
  linkId?: string | null
): Promise<void> {
  await invoke('db_free_element', {
    slideId,
    elementId,
    newElementId,
    linkId: linkId ?? null,
  });
  emit(`slide-elements-changed:${slideId}`);
  emit('elements-changed');
}

export async function dbStoreAsset(
  path: string,
  data: Uint8Array,
  mimeType: string
): Promise<void> {
  await invoke('db_store_asset', { path, data: Array.from(data), mimeType });
}

export async function dbGetAsset(path: string): Promise<Uint8Array> {
  const data = await invoke<number[]>('db_get_asset', { path });
  return new Uint8Array(data);
}

export async function dbUpdatePresentation(key: string, value: string): Promise<void> {
  await invoke('db_update_presentation', { key, value });
  emit('presentation-changed');
}
