import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useOverlay, clearAllOverlayCache, cloneOverlayForDuplicate } from './useOverlay';
import { serializeOverlay, emptyOverlay, OVERLAY_MIME, type Overlay } from './notebookOverlay';

const mockedInvoke = vi.mocked(invoke);

// crypto.randomUUID — present in node 20 webcrypto, but guard for jsdom.
if (!globalThis.crypto?.randomUUID) {
  let n = 0;
  // @ts-expect-error test shim
  globalThis.crypto = { ...globalThis.crypto, randomUUID: () => `uuid-${++n}` };
}

/** Build an invoke mock: returns ownedId for db_get_owned_asset_id,
 *  the serialized overlay bytes for db_get_asset_by_id, and records
 *  db_store_asset calls. */
function mockInvoke(opts: { ownedId?: string | null; overlay?: Overlay } = {}) {
  const storeCalls: Array<Record<string, unknown>> = [];
  // Cast the impl: invoke's InvokeArgs is wider than our test usage.
  mockedInvoke.mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'db_get_owned_asset_id') return opts.ownedId ?? null;
    if (cmd === 'db_get_asset_by_id') {
      const bytes = new TextEncoder().encode(serializeOverlay(opts.overlay ?? emptyOverlay()));
      return bytes.buffer;
    }
    if (cmd === 'db_store_asset') { storeCalls.push(args ?? {}); return (args?.assetId as string) ?? 'new-id'; }
    return undefined;
  }) as unknown as typeof invoke);
  return storeCalls;
}

beforeEach(() => { vi.clearAllMocks(); clearAllOverlayCache(); });
afterEach(() => { vi.useRealTimers(); });

describe('useOverlay load', () => {
  it('starts empty when the element has no owned overlay', async () => {
    mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('db_get_owned_asset_id', { ownerElementId: 'el-1' });
    });
    expect(result.current.overlay).toEqual(emptyOverlay());
  });

  it('loads + parses an existing overlay', async () => {
    const ov = emptyOverlay();
    ov.cellEdits[2] = 'k = 10';
    ov.cellOutputs[2] = [{ kind: 'stream', name: 'stdout', text: 'hi\n' }];
    ov.cellCounts[2] = 5;
    mockInvoke({ ownedId: 'ov-asset', overlay: ov });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => expect(result.current.overlay.cellEdits[2]).toBe('k = 10'));
    expect(result.current.overlay.cellOutputs[2]).toHaveLength(1);
    expect(result.current.overlay.cellCounts[2]).toBe(5);
  });
});

describe('useOverlay mutators', () => {
  it('recordOutput sets outputs + count', async () => {
    mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => expect(result.current.overlay).toEqual(emptyOverlay()));
    act(() => result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'x' }], 1));
    expect(result.current.overlay.cellOutputs[0]).toHaveLength(1);
    expect(result.current.overlay.cellCounts[0]).toBe(1);
  });

  it('setEdit stores; setting saved source clears it', async () => {
    mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => expect(result.current.overlay).toEqual(emptyOverlay()));
    act(() => result.current.setEdit(1, 'changed', 'orig'));
    expect(result.current.overlay.cellEdits[1]).toBe('changed');
    act(() => result.current.setEdit(1, 'orig', 'orig'));
    expect(1 in result.current.overlay.cellEdits).toBe(false);
  });

  it('addAppended / removeAppended', async () => {
    mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => expect(result.current.overlay).toEqual(emptyOverlay()));
    let id = '';
    act(() => { id = result.current.addAppended(2, 'code').id; });
    expect(result.current.overlay.appendedCells).toHaveLength(1);
    expect(result.current.overlay.appendedCells[0].afterIndex).toBe(2);
    act(() => result.current.removeAppended(id));
    expect(result.current.overlay.appendedCells).toHaveLength(0);
  });

  it('clear resets to empty', async () => {
    mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-1'));
    await waitFor(() => expect(result.current.overlay).toEqual(emptyOverlay()));
    act(() => result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'x' }], 1));
    act(() => result.current.clear());
    expect(result.current.overlay).toEqual(emptyOverlay());
  });
});

describe('useOverlay flush', () => {
  it('flushes after the debounce with owner + explicit id + overlay mime', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-9'));
    // let the async load resolve
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });

    act(() => result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'hi' }], 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(storeCalls).toHaveLength(1);
    const call = storeCalls[0];
    expect(call.ownerElementId).toBe('el-9');
    expect(call.mimeType).toBe(OVERLAY_MIME);
    expect(call.externalPath).toBeNull();
    expect(call.autoReload).toBe('off');
    expect(typeof call.assetId).toBe('string');   // explicit client-minted id
    expect((call.assetId as string).length).toBeGreaterThan(0);
  });

  it('does not flush when nothing changed (only-when-changed guard)', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: null });
    renderHook(() => useOverlay('el-x'));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(storeCalls).toHaveLength(0);
  });

  it('survives a remount in-session (the present→edit bug)', async () => {
    mockInvoke({ ownedId: null });
    // First mount (e.g. PresentMode): record an output.
    const first = renderHook(() => useOverlay('el-rm'));
    await waitFor(() => expect(first.result.current.overlay).toEqual(emptyOverlay()));
    act(() => first.result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'out\n' }], 1));
    first.unmount();
    // Remount (e.g. back to the editor): output is still there from the
    // in-session cache, no DB reload race.
    const second = renderHook(() => useOverlay('el-rm'));
    expect(second.result.current.overlay.cellOutputs[0]).toHaveLength(1);
    expect((second.result.current.overlay.cellOutputs[0][0] as { text: string }).text).toBe('out\n');
  });

  it('reuses the loaded asset id on flush (new version, not a new asset)', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: 'existing-ov' });
    const { result } = renderHook(() => useOverlay('el-7'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => result.current.setEdit(0, 'tweak', 'orig'));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0].assetId).toBe('existing-ov');
  });

  it('uses a DETERMINISTIC id when no owned asset exists (not random)', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: null });
    const { result } = renderHook(() => useOverlay('el-det'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'hi' }], 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0].assetId).toBe('overlay-el-det');   // deterministic, not crypto.randomUUID
  });

  it('remounts converge on ONE asset id — no duplicate overlay assets', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: null });   // DB never reports an owned id
    const a = renderHook(() => useOverlay('el-conv'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => a.result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: '1' }], 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    a.unmount();                                          // remount (slide switch, present↔edit)
    const b = renderHook(() => useOverlay('el-conv'));
    act(() => b.result.current.recordOutput(1, [{ kind: 'stream', name: 'stdout', text: '2' }], 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    const ids = new Set(storeCalls.map((c) => c.assetId));
    expect(ids).toEqual(new Set(['overlay-el-conv']));   // exactly one asset, despite two mounts
  });

  it('never creates an asset for an untouched empty overlay', async () => {
    vi.useFakeTimers();
    const storeCalls = mockInvoke({ ownedId: null });
    renderHook(() => useOverlay('el-empty'));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(storeCalls).toHaveLength(0);                   // no empty-overlay asset minted
  });
});

describe('cloneOverlayForDuplicate (B2)', () => {
  it('persists an INDEPENDENT copy and the duplicate shows it', async () => {
    const storeCalls = mockInvoke({ ownedId: null });
    const src = renderHook(() => useOverlay('el-src'));
    await waitFor(() => expect(src.result.current.overlay).toEqual(emptyOverlay()));
    act(() => src.result.current.recordOutput(0, [{ kind: 'stream', name: 'stdout', text: 'hi' }], 1));

    await cloneOverlayForDuplicate('el-src', 'el-dup');

    // A fresh mount of the duplicate shows the cloned output (cache seed).
    const dup = renderHook(() => useOverlay('el-dup'));
    expect(dup.result.current.overlay.cellOutputs[0]).toHaveLength(1);
    // Persisted under el-dup with its OWN asset id (independent).
    const call = storeCalls.find((c) => c.ownerElementId === 'el-dup');
    expect(call).toBeTruthy();
    expect(typeof call!.assetId).toBe('string');
  });

  it('is a no-op when the source overlay is empty', async () => {
    const storeCalls = mockInvoke({ ownedId: null });
    const src = renderHook(() => useOverlay('el-src2'));
    await waitFor(() => expect(src.result.current.overlay).toEqual(emptyOverlay()));
    // never edited → empty → nothing to clone, nothing persisted
    await cloneOverlayForDuplicate('el-src2', 'el-dup2');
    expect(storeCalls.find((c) => c.ownerElementId === 'el-dup2')).toBeFalsy();
  });
});
