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

export type KernelStatus = 'disconnected' | 'connecting' | 'idle' | 'busy' | 'error' | 'dead' | 'no-server';

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
  // 'no-server' when the registry produced no match for the requested
  // kernel. We never attempt to connect in that state — connect() and
  // runCell() reject early with a clear message.
  const noServer = resolved.server == null;
  const [status, setStatus] = useState<KernelStatus>(noServer ? 'no-server' : 'disconnected');
  const [error, setError] = useState<string | null>(noServer
    ? `No registered server advertises a "${resolved.kernelName}" kernel. Add one in Settings → Jupyter servers.`
    : null);

  const serverBaseUrl = resolved.server?.baseUrl ?? '';
  const serverToken = resolved.server?.token ?? '';

  // Recreate client when connection params change. Stops any in-flight
  // kernel under the old config first.
  useEffect(() => {
    return () => {
      const c = clientRef.current;
      clientRef.current = null;
      if (c) void c.stopKernel().catch(() => {});
    };
  }, [serverBaseUrl, serverToken, resolved.kernelName]);

  // When the registry update changes the matched server while mounted
  // (e.g. user just saved a new server in Settings), sync our status
  // out of 'no-server' so the next connect attempt is allowed.
  useEffect(() => {
    if (noServer) {
      setStatus('no-server');
      setError(`No registered server advertises a "${resolved.kernelName}" kernel. Add one in Settings → Jupyter servers.`);
    } else if (status === 'no-server') {
      setStatus('disconnected');
      setError(null);
    }
    // status intentionally NOT in deps — we only want to transition
    // out of no-server, not loop on every status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noServer, resolved.kernelName]);

  const connect = useCallback(async () => {
    if (noServer) {
      const msg = `No registered server advertises a "${resolved.kernelName}" kernel.`;
      setError(msg);
      throw new Error(msg);
    }
    if (clientRef.current?.isConnected) return;
    setStatus('connecting'); setError(null);
    const client = new JupyterClient({
      baseUrl: serverBaseUrl,
      token: serverToken,
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
  }, [noServer, serverBaseUrl, serverToken, resolved.kernelName]);

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
    setStatus(noServer ? 'no-server' : 'disconnected');
    if (c) await c.stopKernel().catch(() => {});
  }, [noServer]);

  return { status, error, connect, runCell, stop };
}
