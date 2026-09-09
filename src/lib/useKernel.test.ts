// Unit tests for the useKernel hook: the React wrapper that owns one
// JupyterClient per NotebookBox. The JupyterClient boundary is fully
// mocked; these tests exercise the hook's own logic — lazy connect,
// no-server gating, status/error state transitions, the onStatus wrapper
// in runCell, recreate-on-param-change, and stop().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { JupyterServerEntry } from './preferences';
import type { ResolvedExternal } from './notebookKernel';
import type { ExecuteCallbacks, ExecuteHandle } from './jupyterClient';

// ---- Controllable JupyterClient stand-in -------------------------------

interface FakeOpts { baseUrl: string; token: string }

class FakeClient {
  static instances: FakeClient[] = [];
  opts: FakeOpts;
  connected = false;
  startedWith: string | null = null;
  stopCount = 0;
  lastExecCode: string | null = null;
  lastExecCallbacks: ExecuteCallbacks | null = null;
  // Behavior knobs, mutated by tests before the call happens.
  startShouldReject: Error | null = null;
  stopShouldReject: Error | null = null;

  constructor(opts: FakeOpts) {
    this.opts = opts;
    FakeClient.instances.push(this);
  }
  get isConnected(): boolean { return this.connected; }
  async startKernel(name: string): Promise<void> {
    this.startedWith = name;
    if (this.startShouldReject) throw this.startShouldReject;
    this.connected = true;
  }
  execute(code: string, callbacks: ExecuteCallbacks = {}): ExecuteHandle {
    this.lastExecCode = code;
    this.lastExecCallbacks = callbacks;
    return {
      done: Promise.resolve({ status: 'ok', executionCount: 1 }),
      msgId: 'exec-1',
      interrupt: async () => {},
    } as unknown as ExecuteHandle;
  }
  async stopKernel(): Promise<void> {
    this.stopCount += 1;
    if (this.stopShouldReject) throw this.stopShouldReject;
    this.connected = false;
  }
}

vi.mock('./jupyterClient', () => ({
  JupyterClient: vi.fn(function (this: unknown, opts: FakeOpts) { return new FakeClient(opts); }),
}));

// ---- Fixtures ----------------------------------------------------------

function server(overrides: Partial<JupyterServerEntry> = {}): JupyterServerEntry {
  return {
    label: 'local',
    baseUrl: 'http://localhost:8888',
    token: 'tok',
    availableKernels: ['python3'],
    ...overrides,
  };
}

function resolved(overrides: Partial<ResolvedExternal> = {}): ResolvedExternal {
  return {
    kind: 'external',
    kernelName: 'python3',
    server: server(),
    ...overrides,
  };
}

// Import after the mock is registered.
import { useKernel } from './useKernel';

describe('useKernel', () => {
  beforeEach(() => { FakeClient.instances = []; });
  afterEach(() => { vi.clearAllMocks(); });

  describe('no-server state', () => {
    const noSrv = resolved({ server: null, kernelName: 'julia-1.10' });

    it('starts in no-server status with a helpful, kernel-named error', () => {
      const { result } = renderHook(() => useKernel(noSrv));
      expect(result.current.status).toBe('no-server');
      expect(result.current.error).toContain('julia-1.10');
      expect(result.current.error).toContain('Settings');
    });

    it('connect() rejects and sets the error without constructing a client', async () => {
      const { result } = renderHook(() => useKernel(noSrv));
      await expect(act(async () => { await result.current.connect(); }))
        .rejects.toThrow(/julia-1\.10/);
      expect(FakeClient.instances).toHaveLength(0);
      expect(result.current.error).toContain('julia-1.10');
    });

    it('runCell() rejects (auto-connect hits the no-server gate)', async () => {
      const { result } = renderHook(() => useKernel(noSrv));
      await expect(act(async () => { await result.current.runCell('x=1'); }))
        .rejects.toThrow(/julia-1\.10/);
      expect(FakeClient.instances).toHaveLength(0);
    });
  });

  describe('connect()', () => {
    it('goes disconnected → idle, building the client from server params', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      expect(result.current.status).toBe('disconnected');
      await act(async () => { await result.current.connect(); });
      expect(result.current.status).toBe('idle');
      expect(result.current.error).toBeNull();
      expect(FakeClient.instances).toHaveLength(1);
      expect(FakeClient.instances[0].opts).toEqual({ baseUrl: 'http://localhost:8888', token: 'tok' });
      expect(FakeClient.instances[0].startedWith).toBe('python3');
    });

    it('is idempotent: a second connect() while connected creates no new client', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.connect(); });
      await act(async () => { await result.current.connect(); });
      expect(FakeClient.instances).toHaveLength(1);
    });

    it('surfaces a start failure as status "error" + message and rethrows', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      // Make the next constructed client reject on startKernel.
      const orig = FakeClient.prototype.startKernel;
      FakeClient.prototype.startKernel = async function () { throw new Error('boom-kernel'); };
      try {
        // Assert the rejection INSIDE act so the catch-block state updates
        // (setStatus('error') + setError) are flushed before we read them.
        await act(async () => {
          await expect(result.current.connect()).rejects.toThrow('boom-kernel');
        });
      } finally {
        FakeClient.prototype.startKernel = orig;
      }
      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('boom-kernel');
    });

    it('coerces a non-Error rejection to a string message', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      const orig = FakeClient.prototype.startKernel;
      FakeClient.prototype.startKernel = async function () { throw 'plain-string-fail'; };
      try {
        await act(async () => {
          await expect(result.current.connect()).rejects.toBeTruthy();
        });
      } finally {
        FakeClient.prototype.startKernel = orig;
      }
      expect(result.current.error).toBe('plain-string-fail');
    });
  });

  describe('runCell()', () => {
    it('auto-connects, then executes the code on the connected client', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.runCell('print(42)'); });
      expect(FakeClient.instances).toHaveLength(1);
      expect(FakeClient.instances[0].lastExecCode).toBe('print(42)');
      expect(result.current.status).toBe('idle');
    });

    it('reuses the existing connection when already connected', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.connect(); });
      await act(async () => { await result.current.runCell('a'); });
      await act(async () => { await result.current.runCell('b'); });
      expect(FakeClient.instances).toHaveLength(1);
      expect(FakeClient.instances[0].lastExecCode).toBe('b');
    });

    it('wraps onStatus: busy/idle/dead drive hook status AND forward to the caller', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      const seen: string[] = [];
      await act(async () => { await result.current.runCell('x', { onStatus: (s) => seen.push(s) }); });
      const wrapped = FakeClient.instances[0].lastExecCallbacks!;

      act(() => { wrapped.onStatus!('busy'); });
      expect(result.current.status).toBe('busy');
      act(() => { wrapped.onStatus!('dead'); });
      expect(result.current.status).toBe('dead');
      act(() => { wrapped.onStatus!('idle'); });
      expect(result.current.status).toBe('idle');

      // A status the hook does NOT map (e.g. 'starting') is forwarded but
      // leaves hook status untouched.
      act(() => { wrapped.onStatus!('starting' as unknown as 'idle'); });
      expect(result.current.status).toBe('idle');

      expect(seen).toEqual(['busy', 'dead', 'idle', 'starting']);
    });

    it('preserves caller callbacks other than onStatus', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      const onReply = vi.fn();
      await act(async () => { await result.current.runCell('x', { onReply }); });
      const wrapped = FakeClient.instances[0].lastExecCallbacks!;
      expect(wrapped.onReply).toBe(onReply);
    });
  });

  describe('stop()', () => {
    it('closes the kernel and returns to disconnected', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.connect(); });
      const client = FakeClient.instances[0];
      await act(async () => { await result.current.stop(); });
      expect(client.stopCount).toBe(1);
      expect(result.current.status).toBe('disconnected');
    });

    it('swallows a stopKernel rejection (best-effort)', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.connect(); });
      FakeClient.instances[0].stopShouldReject = new Error('stop-fail');
      await act(async () => { await result.current.stop(); });
      expect(result.current.status).toBe('disconnected');
    });

    it('is a no-op-safe call when never connected', async () => {
      const { result } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.stop(); });
      expect(FakeClient.instances).toHaveLength(0);
      expect(result.current.status).toBe('disconnected');
    });
  });

  describe('reacting to resolved changes', () => {
    it('transitions out of no-server when a matching server appears', async () => {
      const { result, rerender } = renderHook((r: ResolvedExternal) => useKernel(r), {
        initialProps: resolved({ server: null }),
      });
      expect(result.current.status).toBe('no-server');
      await act(async () => { rerender(resolved()); });
      expect(result.current.status).toBe('disconnected');
      expect(result.current.error).toBeNull();
    });

    it('transitions into no-server when the server disappears', async () => {
      const { result, rerender } = renderHook((r: ResolvedExternal) => useKernel(r), {
        initialProps: resolved(),
      });
      expect(result.current.status).toBe('disconnected');
      await act(async () => { rerender(resolved({ server: null, kernelName: 'r-4.3' })); });
      expect(result.current.status).toBe('no-server');
      expect(result.current.error).toContain('r-4.3');
    });

    it('stops the old kernel when connection params change', async () => {
      const { result, rerender } = renderHook((r: ResolvedExternal) => useKernel(r), {
        initialProps: resolved(),
      });
      await act(async () => { await result.current.connect(); });
      const first = FakeClient.instances[0];
      // Change the baseUrl → cleanup effect must stop the old client.
      await act(async () => { rerender(resolved({ server: server({ baseUrl: 'http://other:8888' }) })); });
      expect(first.stopCount).toBe(1);
    });

    it('stops the kernel on unmount', async () => {
      const { result, unmount } = renderHook(() => useKernel(resolved()));
      await act(async () => { await result.current.connect(); });
      const client = FakeClient.instances[0];
      unmount();
      expect(client.stopCount).toBe(1);
    });
  });
});
