// React hook: own a JupyterClient for the lifetime of one NotebookBox.
// Lazy: no connection until runCell() is called the first time. That
// matches the design intent — scrolling a slide with a notebook on it
// should never start a kernel.
//
// On unmount: stopKernel() is called best-effort. Slide nav → kernel
// dies (v1 accepts this; v1.5 will keep iframes/kernels alive across
// nav by hoisting state out of the element).

import { useEffect, useRef, useState, useCallback } from 'react';
import { JupyterClient, ExecuteCallbacks, ExecuteHandle } from './jupyterClient';
import { ResolvedExternal } from './notebookKernel';

export type KernelStatus = 'disconnected' | 'connecting' | 'idle' | 'busy' | 'error' | 'dead';

export interface UseKernelResult {
  status: KernelStatus;
  /** Human-readable error from the last failed connect / execute. */
  error: string | null;
  /** Start kernel + connect WS. Idempotent. Returns a Promise so the
   *  caller can await first-run delays before sending execute. */
  connect(): Promise<void>;
  /** Send execute_request. Auto-connects if not yet connected.
   *  Returns the handle (msgId, done promise, interrupt). */
  runCell(code: string, callbacks?: ExecuteCallbacks): Promise<ExecuteHandle>;
  /** Stop kernel + close WS. Used by "Restart Kernel" button. */
  stop(): Promise<void>;
}

export function useKernel(resolved: ResolvedExternal): UseKernelResult {
  const clientRef = useRef<JupyterClient | null>(null);
  const [status, setStatus] = useState<KernelStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Recreate client when connection params change. Stops any in-flight
  // kernel under the old config first.
  useEffect(() => {
    return () => {
      const c = clientRef.current;
      clientRef.current = null;
      if (c) void c.stopKernel().catch(() => {});
    };
  }, [resolved.baseUrl, resolved.token, resolved.kernelName]);

  const connect = useCallback(async () => {
    if (clientRef.current?.isConnected) return;
    setStatus('connecting'); setError(null);
    const client = new JupyterClient({
      baseUrl: resolved.baseUrl,
      token: resolved.token,
    });
    try {
      await client.startKernel(resolved.kernelName);
      clientRef.current = client;
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [resolved.baseUrl, resolved.token, resolved.kernelName]);

  const runCell = useCallback(async (code: string, callbacks?: ExecuteCallbacks) => {
    if (!clientRef.current?.isConnected) await connect();
    const client = clientRef.current;
    if (!client) throw new Error('useKernel: connect did not produce a client');
    const wrapped: ExecuteCallbacks = {
      ...callbacks,
      onStatus: (s) => {
        if (s === 'busy' || s === 'idle' || s === 'dead') setStatus(s);
        callbacks?.onStatus?.(s);
      },
    };
    return client.execute(code, wrapped);
  }, [connect]);

  const stop = useCallback(async () => {
    const c = clientRef.current;
    clientRef.current = null;
    setStatus('disconnected');
    if (c) await c.stopKernel().catch(() => {});
  }, []);

  return { status, error, connect, runCell, stop };
}
