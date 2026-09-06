// Unit tests for the SQLite-backed store facade (src/store/db.ts).
//
// The Tauri `invoke` boundary is mocked (globally in src/test/setup.ts; we
// grab the handle here and drive per-command return values). What these tests
// actually exercise is the module's OWN logic, not Tauri:
//   - the in-memory UI state machine (selection, presenting, inspector, index)
//     and its emitUI-driven re-render of useUIState,
//   - toggleSelectElement's slide → element → multi → element/slide transitions,
//   - the argument marshalling each write helper does (JSON.stringify, linkId
//     stripping, `?? null` coercion, Array.from on asset bytes),
//   - JSON.parse of the export/compact/gc return payloads,
//   - the event-bus → hook re-fetch wiring (a write helper's emit() drives the
//     matching read hook to reload), including the per-slide scoped channel,
//   - the read hooks' null-guard and catch/console.error paths.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import type { Slide, SlideElement, Presentation } from '../types/presentation';

import {
  useUIState,
  setCurrentSlideIndex,
  setPresenting,
  toggleProperties,
  setProjectPath,
  selectObject,
  toggleSelectElement,
  dbOpen,
  dbClose,
  dbImportJson,
  dbExportJson,
  useSlides,
  useSlideElements,
  usePresentationConfig,
  dbUpdateElement,
  dbAddElement,
  dbRemoveElementFromSlide,
  dbCompact,
  dbGcAssets,
  dbAddSlide,
  dbDeleteSlide,
  dbDuplicateSlide,
  dbMoveSlide,
  dbUpdateSlide,
  dbUpdateZOrder,
  dbFreeElement,
  dbStoreAsset,
  dbGetAsset,
  dbUpdatePresentation,
} from './db';

const mockInvoke = vi.mocked(invoke);

// Read the (command, args) of the i-th invoke call in a type-safe way.
function callAt(i: number): { cmd: string; args: Record<string, unknown> } {
  const calls = mockInvoke.mock.calls as unknown[][];
  return { cmd: calls[i][0] as string, args: (calls[i][1] ?? {}) as Record<string, unknown> };
}
// The single most recent invoke.
function lastCall(): { cmd: string; args: Record<string, unknown> } {
  const calls = mockInvoke.mock.calls as unknown[][];
  return callAt(calls.length - 1);
}

// Dispatch invoke by command name so a hook + the write that pokes it can both
// resolve during one test.
function routeInvoke(map: Record<string, unknown>) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd in map) {
      const v = map[cmd];
      return Promise.resolve(typeof v === 'function' ? (v as () => unknown)() : v);
    }
    return Promise.resolve(undefined);
  }) as unknown as typeof invoke);
}

const slide = (id: string, position = 0): Slide =>
  ({ id, position, elements: [] } as unknown as Slide);

const element = (over: Partial<SlideElement> = {}): SlideElement =>
  ({ id: 'el-1', type: 'text', x: 0, y: 0, ...over } as unknown as SlideElement);

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  // Reset the module-global UI state to a known baseline (no reset export,
  // so drive it through the setters).
  setCurrentSlideIndex(0);
  setPresenting(false);
  setProjectPath(null);
  selectObject({ type: 'slide' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// UI state machine
// ---------------------------------------------------------------------------

describe('useUIState + setters', () => {
  it('re-renders with each setter and reflects the new value', () => {
    const { result } = renderHook(() => useUIState());
    expect(result.current.currentSlideIndex).toBe(0);
    expect(result.current.isPresenting).toBe(false);
    expect(result.current.projectPath).toBeNull();
    expect(result.current.selectedObject).toEqual({ type: 'slide' });

    act(() => setCurrentSlideIndex(4));
    expect(result.current.currentSlideIndex).toBe(4);

    act(() => setPresenting(true));
    expect(result.current.isPresenting).toBe(true);

    act(() => setProjectPath('/decks/talk.eigendeck'));
    expect(result.current.projectPath).toBe('/decks/talk.eigendeck');

    act(() => selectObject({ type: 'element', id: 'z' }));
    expect(result.current.selectedObject).toEqual({ type: 'element', id: 'z' });
  });

  it('toggleProperties flips the inspector flag on each call', () => {
    const { result } = renderHook(() => useUIState());
    const start = result.current.showProperties;
    act(() => toggleProperties());
    expect(result.current.showProperties).toBe(!start);
    act(() => toggleProperties());
    expect(result.current.showProperties).toBe(start);
  });

  it('stops notifying after the component unmounts (listener cleanup)', () => {
    const { result, unmount } = renderHook(() => useUIState());
    act(() => setCurrentSlideIndex(2));
    expect(result.current.currentSlideIndex).toBe(2);
    unmount();
    // No throw and no stale render: setter still runs with the listener gone.
    expect(() => setCurrentSlideIndex(9)).not.toThrow();
  });
});

describe('toggleSelectElement', () => {
  const sel = () => renderHook(() => useUIState()).result;

  it('from slide/none selects the single element', () => {
    const result = sel();
    act(() => selectObject({ type: 'slide' }));
    act(() => toggleSelectElement('a'));
    expect(result.current.selectedObject).toEqual({ type: 'element', id: 'a' });
  });

  it('from null (nothing selected) selects the single element', () => {
    const result = sel();
    act(() => selectObject(null));
    act(() => toggleSelectElement('a'));
    expect(result.current.selectedObject).toEqual({ type: 'element', id: 'a' });
  });

  it('toggling the same single element clears back to slide', () => {
    const result = sel();
    act(() => selectObject({ type: 'element', id: 'a' }));
    act(() => toggleSelectElement('a'));
    expect(result.current.selectedObject).toEqual({ type: 'slide' });
  });

  it('a different element promotes single → multi', () => {
    const result = sel();
    act(() => selectObject({ type: 'element', id: 'a' }));
    act(() => toggleSelectElement('b'));
    expect(result.current.selectedObject).toEqual({ type: 'multi', ids: ['a', 'b'] });
  });

  it('adds a new id to an existing multi-selection', () => {
    const result = sel();
    act(() => selectObject({ type: 'multi', ids: ['a', 'b'] }));
    act(() => toggleSelectElement('c'));
    expect(result.current.selectedObject).toEqual({ type: 'multi', ids: ['a', 'b', 'c'] });
  });

  it('removing from a 3-way multi drops to a 2-way multi', () => {
    const result = sel();
    act(() => selectObject({ type: 'multi', ids: ['a', 'b', 'c'] }));
    act(() => toggleSelectElement('b'));
    expect(result.current.selectedObject).toEqual({ type: 'multi', ids: ['a', 'c'] });
  });

  it('removing to one remaining collapses multi → single element', () => {
    const result = sel();
    act(() => selectObject({ type: 'multi', ids: ['a', 'b'] }));
    act(() => toggleSelectElement('a'));
    expect(result.current.selectedObject).toEqual({ type: 'element', id: 'b' });
  });

  it('removing the last of a multi collapses to slide', () => {
    const result = sel();
    // A degenerate one-id multi: toggling that id empties it → slide.
    act(() => selectObject({ type: 'multi', ids: ['a'] }));
    act(() => toggleSelectElement('a'));
    expect(result.current.selectedObject).toEqual({ type: 'slide' });
  });
});

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

describe('db lifecycle', () => {
  it('dbOpen invokes db_open, records the project path, and refreshes UI', async () => {
    const { result } = renderHook(() => useUIState());
    await act(async () => { await dbOpen('/decks/a.eigendeck'); });
    expect(callAt(0)).toEqual({ cmd: 'db_open', args: { path: '/decks/a.eigendeck' } });
    expect(result.current.projectPath).toBe('/decks/a.eigendeck');
  });

  it('dbClose invokes db_close and clears the project path', async () => {
    const { result } = renderHook(() => useUIState());
    act(() => setProjectPath('/decks/a.eigendeck'));
    await act(async () => { await dbClose(); });
    expect(lastCall().cmd).toBe('db_close');
    expect(result.current.projectPath).toBeNull();
  });

  it('dbImportJson serializes the presentation into the json arg', async () => {
    const pres = { title: 'T', config: {}, slides: [] } as unknown as Presentation;
    await dbImportJson(pres);
    const { cmd, args } = lastCall();
    expect(cmd).toBe('db_import_json');
    expect(JSON.parse(args.json as string)).toEqual(pres);
  });

  it('dbExportJson parses the returned JSON string into an object', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ title: 'Hi', config: { theme: 'x' }, slides: [] }));
    const out = await dbExportJson();
    expect(out).toEqual({ title: 'Hi', config: { theme: 'x' }, slides: [] });
  });
});

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

describe('useSlides', () => {
  it('loads and parses slides on mount', async () => {
    routeInvoke({ db_get_slides: JSON.stringify([slide('s1'), slide('s2', 1)]) });
    const { result } = renderHook(() => useSlides());
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0].id).toBe('s1');
  });

  it('re-fetches when a slide write emits slides-changed', async () => {
    let payload = [slide('s1')];
    routeInvoke({
      db_get_slides: () => JSON.stringify(payload),
      db_add_slide: undefined,
    });
    const { result } = renderHook(() => useSlides());
    await waitFor(() => expect(result.current).toHaveLength(1));

    payload = [slide('s1'), slide('s2', 1)];
    await act(async () => { await dbAddSlide('s2', 1); });
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('logs and keeps an empty list when the fetch rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error('db closed'));
    const { result } = renderHook(() => useSlides());
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    expect(err.mock.calls[0][0]).toContain('Failed to load slides');
  });
});

describe('useSlideElements', () => {
  it('returns an empty list and does not fetch when slideId is null', async () => {
    const { result } = renderHook(() => useSlideElements(null));
    expect(result.current).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalledWith('db_get_slide_elements', expect.anything());
  });

  it('loads elements for the given slide', async () => {
    routeInvoke({ db_get_slide_elements: JSON.stringify([element({ id: 'e1' })]) });
    const { result } = renderHook(() => useSlideElements('s1'));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe('e1');
    expect(callAt(0)).toEqual({ cmd: 'db_get_slide_elements', args: { slideId: 's1' } });
  });

  it('re-fetches on the slide-scoped channel (slide-elements-changed:<id>)', async () => {
    let payload = [element({ id: 'e1' })];
    routeInvoke({
      db_get_slide_elements: () => JSON.stringify(payload),
      db_remove_element_from_slide: undefined,
    });
    const { result } = renderHook(() => useSlideElements('s1'));
    await waitFor(() => expect(result.current).toHaveLength(1));

    payload = [];
    // dbRemoveElementFromSlide emits ONLY the scoped channel — proves the hook
    // subscribed to slide-elements-changed:s1, not just the global one.
    await act(async () => { await dbRemoveElementFromSlide('s1', 'e1'); });
    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  it('re-fetches on the global elements-changed channel', async () => {
    let payload = [element({ id: 'e1' })];
    routeInvoke({
      db_get_slide_elements: () => JSON.stringify(payload),
      db_update_element: undefined,
    });
    const { result } = renderHook(() => useSlideElements('s1'));
    await waitFor(() => expect(result.current).toHaveLength(1));

    payload = [element({ id: 'e1' }), element({ id: 'e2' })];
    await act(async () => { await dbUpdateElement('e1', { x: 5 }); });
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('re-fetches from scratch when slideId changes', async () => {
    // Route by the slideId arg specifically.
    mockInvoke.mockImplementation(((cmd: string, args: { slideId: string }) => {
      if (cmd === 'db_get_slide_elements') {
        return Promise.resolve(
          args.slideId === 's2'
            ? JSON.stringify([element({ id: 'e2' }), element({ id: 'e3' })])
            : JSON.stringify([element({ id: 'e1' })]),
        );
      }
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    const { result, rerender } = renderHook(({ id }: { id: string }) => useSlideElements(id), {
      initialProps: { id: 's1' },
    });
    await waitFor(() => expect(result.current).toHaveLength(1));
    rerender({ id: 's2' });
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('logs and keeps an empty list when the fetch rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValue('nope');
    const { result } = renderHook(() => useSlideElements('s1'));
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

describe('usePresentationConfig', () => {
  it('extracts title and config from the exported presentation', async () => {
    routeInvoke({ db_export_json: JSON.stringify({ title: 'Talk', config: { theme: 'noir' }, slides: [] }) });
    const { result } = renderHook(() => usePresentationConfig());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({ title: 'Talk', config: { theme: 'noir' } });
  });

  it('stays null when the DB is not open (export rejects), without logging', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error('no db'));
    const { result } = renderHook(() => usePresentationConfig());
    // Give the rejected load a tick to settle.
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it('re-fetches on presentation-changed', async () => {
    let payload = { title: 'A', config: {}, slides: [] };
    routeInvoke({
      db_export_json: () => JSON.stringify(payload),
      db_update_presentation: undefined,
    });
    const { result } = renderHook(() => usePresentationConfig());
    await waitFor(() => expect(result.current?.title).toBe('A'));

    payload = { title: 'B', config: {}, slides: [] };
    await act(async () => { await dbUpdatePresentation('title', 'B'); });
    await waitFor(() => expect(result.current?.title).toBe('B'));
  });
});

// ---------------------------------------------------------------------------
// Write operations: argument marshalling
// ---------------------------------------------------------------------------

describe('write op argument marshalling', () => {
  it('dbUpdateElement stringifies data and passes linkId through (defaulting to null)', async () => {
    await dbUpdateElement('el-1', { x: 3, y: 4 });
    expect(lastCall()).toEqual({
      cmd: 'db_update_element',
      args: { id: 'el-1', data: JSON.stringify({ x: 3, y: 4 }), linkId: null },
    });
    await dbUpdateElement('el-1', { x: 3 }, 'link-9');
    expect((lastCall().args as { linkId: string }).linkId).toBe('link-9');
  });

  it('dbAddElement strips linkId out of the element body and sends it separately', async () => {
    const el = element({ id: 'e9', type: 'image', linkId: 'L1' } as Partial<SlideElement>);
    await dbAddElement('s1', el, 7);
    const { cmd, args } = callAt(0);
    expect(cmd).toBe('db_add_element');
    expect(args.slideId).toBe('s1');
    expect(args.elementId).toBe('e9');
    expect(args.elementType).toBe('image');
    expect(args.linkId).toBe('L1');
    expect(args.zOrder).toBe(7);
    // linkId must NOT be duplicated inside the serialized data blob.
    const data = JSON.parse(args.data as string);
    expect(data.linkId).toBeUndefined();
    expect(data.id).toBe('e9');
  });

  it('dbAddElement defaults a missing linkId to null', async () => {
    await dbAddElement('s1', element({ id: 'e0' }), 0);
    expect((callAt(0).args as { linkId: unknown }).linkId).toBeNull();
  });

  it('dbUpdateSlide coerces every missing change field to null', async () => {
    await dbUpdateSlide('s1', { notes: 'hi' });
    expect(lastCall()).toEqual({
      cmd: 'db_update_slide',
      args: { slideId: 's1', notes: 'hi', groupId: null, config: null },
    });
  });

  it('dbUpdateSlide passes an empty-string config through (the CLEAR sentinel)', async () => {
    await dbUpdateSlide('s1', { config: '' });
    expect((lastCall().args as { config: string }).config).toBe('');
  });

  it('dbAddSlide / dbDuplicateSlide default groupId to null', async () => {
    await dbAddSlide('s1', 2);
    expect(lastCall().args).toEqual({ id: 's1', position: 2, groupId: null });
    await dbDuplicateSlide('src', 'dst', 3);
    expect(lastCall().args).toEqual({ sourceSlideId: 'src', newSlideId: 'dst', newPosition: 3, groupId: null });
    await dbDuplicateSlide('src', 'dst', 3, 'grp');
    expect((lastCall().args as { groupId: string }).groupId).toBe('grp');
  });

  it('dbMoveSlide / dbDeleteSlide / dbUpdateZOrder pass their positional args verbatim', async () => {
    await dbMoveSlide('s1', 5);
    expect(lastCall()).toEqual({ cmd: 'db_move_slide', args: { slideId: 's1', newPosition: 5 } });
    await dbDeleteSlide('s1');
    expect(lastCall()).toEqual({ cmd: 'db_delete_slide', args: { slideId: 's1' } });
    await dbUpdateZOrder('s1', 'e1', 9);
    expect(lastCall()).toEqual({ cmd: 'db_update_z_order', args: { slideId: 's1', elementId: 'e1', newZOrder: 9 } });
  });

  it('dbFreeElement defaults linkId to null and forwards the new id', async () => {
    await dbFreeElement('s1', 'old', 'new');
    expect(lastCall()).toEqual({
      cmd: 'db_free_element',
      args: { slideId: 's1', elementId: 'old', newElementId: 'new', linkId: null },
    });
  });

  it('dbStoreAsset converts the Uint8Array payload to a plain number array', async () => {
    await dbStoreAsset('/img.png', new Uint8Array([1, 2, 255]), 'image/png');
    const { cmd, args } = lastCall();
    expect(cmd).toBe('db_store_asset');
    expect(args.path).toBe('/img.png');
    expect(args.mimeType).toBe('image/png');
    expect(Array.isArray(args.data)).toBe(true);
    expect(args.data).toEqual([1, 2, 255]);
  });

  it('dbGetAsset wraps the returned number[] back into a Uint8Array', async () => {
    mockInvoke.mockResolvedValueOnce([10, 20, 30]);
    const out = await dbGetAsset('/img.png');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([10, 20, 30]);
  });

  it('dbUpdatePresentation forwards the key/value pair', async () => {
    await dbUpdatePresentation('title', 'New Title');
    expect(lastCall()).toEqual({ cmd: 'db_update_presentation', args: { key: 'title', value: 'New Title' } });
  });
});

describe('write ops that parse a JSON return payload', () => {
  it('dbCompact parses the byte-stats and passes deleteAll as keepAll', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ beforeBytes: 100, afterBytes: 40, savedBytes: 60 }));
    const stats = await dbCompact(true);
    expect(stats).toEqual({ beforeBytes: 100, afterBytes: 40, savedBytes: 60 });
    expect(lastCall()).toEqual({ cmd: 'db_compact', args: { keepAll: true } });
  });

  it('dbCompact defaults deleteAll to false', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ beforeBytes: 0, afterBytes: 0, savedBytes: 0 }));
    await dbCompact();
    expect((lastCall().args as { keepAll: boolean }).keepAll).toBe(false);
  });

  it('dbGcAssets parses the full removal/byte report', async () => {
    const report = {
      removedAssets: 2,
      removedVersions: 5,
      removedCacheRows: 3,
      beforeBytes: 900,
      afterBytes: 500,
      bytesFreed: 400,
    };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(report));
    const out = await dbGcAssets();
    expect(out).toEqual(report);
    expect(lastCall().cmd).toBe('db_gc_assets');
  });
});
