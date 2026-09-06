// Unit tests for the useNotebook hook: the React wrapper that loads an
// asset's bytes from SQLite (via `invoke('db_get_asset_by_id')`), parses
// them as .ipynb, and hands back a Notebook. Both boundaries — the Tauri
// `invoke` and `parseNotebookBytes` — are mocked, so these tests exercise
// the hook's own logic: the module-level cache + inflight dedup, the
// success/error state machine, the loading derivation, the assetId-change
// reaction, and the `eigendeck:asset-changed` reload path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Notebook } from './notebookFormat';

// ---- Mocked boundaries -------------------------------------------------

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const parseMock = vi.fn();
vi.mock('./notebookParser', () => ({
  parseNotebookBytes: (...args: unknown[]) => parseMock(...args),
}));

// Import after the mocks are registered.
import { useNotebook } from './useNotebook';

// ---- Fixtures ----------------------------------------------------------

// The module-level cache/inflight maps persist for the life of the test
// file, so every test uses a fresh assetId to avoid cross-test bleed.
let idSeq = 0;
function uid(): string {
  return `asset-${idSeq++}-${Math.random().toString(36).slice(2)}`;
}

function nb(name: string | null = 'python3'): Notebook {
  return { cells: [], kernelspecName: name, kernelDisplayName: null, language: null };
}

function assetChanged(assetId: unknown): void {
  window.dispatchEvent(
    new CustomEvent('eigendeck:asset-changed', { detail: { assetId } }),
  );
}

describe('useNotebook', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    parseMock.mockReset();
  });

  describe('no assetId', () => {
    it('returns a null notebook and never touches the backend', () => {
      const { result } = renderHook(() => useNotebook(undefined));
      expect(result.current.notebook).toBeNull();
      expect(result.current.error).toBeNull();
      expect(invokeMock).not.toHaveBeenCalled();
      expect(parseMock).not.toHaveBeenCalled();
    });
  });

  describe('successful load', () => {
    it('invokes db_get_asset_by_id, parses the bytes, and exposes the notebook', async () => {
      const id = uid();
      const buf = new ArrayBuffer(8);
      invokeMock.mockResolvedValue(buf);
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const { result } = renderHook(() => useNotebook(id));
      // Nothing resolved yet: loading is derived from null notebook + null error.
      expect(result.current.loading).toBe(true);

      await waitFor(() => expect(result.current.notebook).toBe(notebook));
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(invokeMock).toHaveBeenCalledWith('db_get_asset_by_id', { assetId: id });
      expect(parseMock).toHaveBeenCalledWith(buf);
    });

    it('serves a warm-cache notebook synchronously on a fresh mount, without re-invoking', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(4));
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const first = renderHook(() => useNotebook(id));
      await waitFor(() => expect(first.result.current.notebook).toBe(notebook));

      invokeMock.mockClear();
      parseMock.mockClear();

      // A second hook for the same id reads the cache in the useState
      // initializer — notebook is present on the first render, not loading.
      const second = renderHook(() => useNotebook(id));
      expect(second.result.current.notebook).toBe(notebook);
      expect(second.result.current.loading).toBe(false);
      // The reload effect still runs but loadNotebook short-circuits on the cache.
      await Promise.resolve();
      expect(invokeMock).not.toHaveBeenCalled();
      expect(parseMock).not.toHaveBeenCalled();
    });

    it('dedups two concurrent mounts of the same asset into a single in-flight load', async () => {
      const id = uid();
      let resolveInvoke!: (v: ArrayBuffer) => void;
      invokeMock.mockReturnValue(
        new Promise<ArrayBuffer>((res) => { resolveInvoke = res; }),
      );
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const a = renderHook(() => useNotebook(id));
      const b = renderHook(() => useNotebook(id));
      // Both share the inflight promise: only one invoke went out.
      expect(invokeMock).toHaveBeenCalledTimes(1);

      await act(async () => { resolveInvoke(new ArrayBuffer(1)); });
      await waitFor(() => expect(a.result.current.notebook).toBe(notebook));
      await waitFor(() => expect(b.result.current.notebook).toBe(notebook));
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('error paths', () => {
    it('surfaces an invoke rejection as error and clears loading (no notebook)', async () => {
      const id = uid();
      invokeMock.mockRejectedValue(new Error('db-fail'));

      const { result } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(result.current.error).toEqual(new Error('db-fail')));
      expect(result.current.notebook).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(parseMock).not.toHaveBeenCalled();
    });

    it('surfaces a parse throw as error', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(2));
      parseMock.mockImplementation(() => { throw new Error('bad-ipynb'); });

      const { result } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(result.current.error?.message).toBe('bad-ipynb'));
      expect(result.current.notebook).toBeNull();
    });

    it('does not cache a failed load: a later mount retries the backend', async () => {
      const id = uid();
      invokeMock.mockRejectedValueOnce(new Error('transient'));
      const { result: r1 } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(r1.current.error).toBeTruthy());

      const notebook = nb();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      parseMock.mockReturnValue(notebook);
      const { result: r2 } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(r2.current.notebook).toBe(notebook));
      // First failed, second succeeded → two separate invocations.
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('asset-changed reload', () => {
    it('invalidates the cache and re-parses on a matching assetId event', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      const n1 = nb('python3');
      const n2 = nb('julia-1.10');
      parseMock.mockReturnValueOnce(n1).mockReturnValueOnce(n2);

      const { result } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(result.current.notebook).toBe(n1));

      act(() => { assetChanged(id); });
      await waitFor(() => expect(result.current.notebook).toBe(n2));
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });

    it('ignores an event for a different assetId', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const { result } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(result.current.notebook).toBe(notebook));

      invokeMock.mockClear();
      act(() => { assetChanged(`${id}-other`); });
      await Promise.resolve();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('ignores an event whose detail carries no assetId', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const { result } = renderHook(() => useNotebook(id));
      await waitFor(() => expect(result.current.notebook).toBe(notebook));

      invokeMock.mockClear();
      act(() => { assetChanged(undefined); });
      await Promise.resolve();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('does not subscribe when there is no assetId (event is a no-op)', () => {
      renderHook(() => useNotebook(undefined));
      // No listener was registered, so dispatching must not invoke anything.
      act(() => { assetChanged('anything'); });
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe('reacting to assetId changes', () => {
    it('loads the new asset when the assetId prop changes', async () => {
      const id1 = uid();
      const id2 = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      const n1 = nb('a');
      const n2 = nb('b');
      parseMock.mockReturnValueOnce(n1).mockReturnValueOnce(n2);

      const { result, rerender } = renderHook((p: string) => useNotebook(p), {
        initialProps: id1,
      });
      await waitFor(() => expect(result.current.notebook).toBe(n1));

      rerender(id2);
      await waitFor(() => expect(result.current.notebook).toBe(n2));
      expect(invokeMock).toHaveBeenCalledWith('db_get_asset_by_id', { assetId: id2 });
    });

    it('clears notebook and error when the assetId becomes undefined', async () => {
      const id = uid();
      invokeMock.mockResolvedValue(new ArrayBuffer(1));
      const notebook = nb();
      parseMock.mockReturnValue(notebook);

      const { result, rerender } = renderHook(
        (p: string | undefined) => useNotebook(p),
        { initialProps: id as string | undefined },
      );
      await waitFor(() => expect(result.current.notebook).toBe(notebook));

      act(() => { rerender(undefined); });
      expect(result.current.notebook).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
