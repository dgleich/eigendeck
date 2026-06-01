// JupyterClient — REST + WebSocket against a user-run jupyter server.
// Factored from public/notebook-spike/external-kernel.html — same
// protocol, packaged for reuse.
//
// Lifecycle:
//   const client = new JupyterClient({ baseUrl, token });
//   await client.startKernel('python3');     // POST /api/kernels + WS connect
//   const handle = client.execute(code, callbacks);  // execute_request
//   handle.interrupt();
//   await client.stopKernel();               // DELETE /api/kernels + WS close
//
// Callbacks fire as iopub messages stream in:
//   onStream({ name, text })
//   onDisplayData({ data })
//   onExecuteResult({ data, executionCount })
//   onError({ ename, evalue, traceback })
//   onStatus('busy' | 'idle' | 'dead')
//
// The returned handle resolves when execute_reply arrives on the
// shell channel (i.e. the cell finished, successfully or not).

import { MimeBundle } from './notebookFormat';

export interface JupyterClientOptions {
  baseUrl: string;     // e.g. 'http://localhost:8888'
  token: string;       // empty string for unauthenticated server
}

export interface ExecuteCallbacks {
  onStream?: (s: { name: 'stdout' | 'stderr'; text: string }) => void;
  onDisplayData?: (d: { data: MimeBundle }) => void;
  onExecuteResult?: (r: { data: MimeBundle; executionCount: number | null }) => void;
  onError?: (e: { ename: string; evalue: string; traceback: string[] }) => void;
  onStatus?: (s: 'busy' | 'idle' | 'dead') => void;
}

export interface ExecuteHandle {
  /** Resolves when the kernel sends execute_reply (status: ok|error|aborted). */
  done: Promise<'ok' | 'error' | 'aborted'>;
  /** Send an interrupt to the kernel (kernel-level Ctrl-C). */
  interrupt(): Promise<void>;
  /** Message id of the execute_request — useful for log correlation. */
  msgId: string;
}

interface PendingExecution {
  resolve: (status: 'ok' | 'error' | 'aborted') => void;
  callbacks: ExecuteCallbacks;
}

export interface KernelSpec {
  name: string;
  displayName: string;
  language: string | null;
}

function uuid(): string {
  // RFC 4122 v4 — good enough for client-side correlation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class JupyterClient {
  private baseUrl: string;
  private token: string;
  private session = uuid();
  private kernel: { id: string; name: string } | null = null;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingExecution>();

  constructor(opts: JupyterClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get kernelId(): string | null {
    return this.kernel?.id ?? null;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { ...extra, Authorization: `token ${this.token}` } : extra;
  }

  private authQuery(): string {
    return this.token ? `?token=${encodeURIComponent(this.token)}` : '';
  }

  /** GET /api/kernelspecs — list available kernels on the server. */
  async listKernelSpecs(): Promise<KernelSpec[]> {
    const r = await fetch(`${this.baseUrl}/api/kernelspecs${this.authQuery()}`, {
      headers: this.authHeaders(),
    });
    if (!r.ok) throw new Error(`kernelspecs: ${r.status} ${r.statusText}`);
    const data = await r.json();
    const specs = data.kernelspecs ?? {};
    return Object.entries(specs).map(([name, info]) => {
      const i = info as { spec?: { display_name?: string; language?: string } };
      return {
        name,
        displayName: i.spec?.display_name ?? name,
        language: i.spec?.language ?? null,
      };
    });
  }

  /** POST /api/kernels + open WS channels. Idempotent: if a kernel is
   *  already running, returns immediately. */
  async startKernel(kernelName: string): Promise<void> {
    if (this.kernel) return;
    const r = await fetch(`${this.baseUrl}/api/kernels${this.authQuery()}`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: kernelName }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`startKernel: ${r.status} ${r.statusText} — ${txt}`);
    }
    const k = (await r.json()) as { id: string; name: string };
    this.kernel = { id: k.id, name: k.name };
    await this.openChannels();
  }

  private openChannels(): Promise<void> {
    if (!this.kernel) return Promise.reject(new Error('no kernel'));
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    const url = `${wsBase}/api/kernels/${this.kernel.id}/channels${this.authQuery()}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error during open'));
      ws.onmessage = (ev) => this.handleMessage(ev.data);
      ws.onclose = () => {
        // Notify all pending executions that the kernel went away.
        for (const [, p] of this.pending) {
          p.callbacks.onStatus?.('dead');
          p.resolve('aborted');
        }
        this.pending.clear();
        this.ws = null;
      };
    });
  }

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== 'string') return; // binary buffers aren't used by our message types
    let msg: {
      header?: { msg_type?: string };
      parent_header?: { msg_id?: string };
      channel?: string;
      content?: Record<string, unknown>;
    };
    try { msg = JSON.parse(raw); } catch { return; }
    const t = msg.header?.msg_type;
    const parentId = msg.parent_header?.msg_id;
    const c = msg.content ?? {};
    if (!parentId) return;
    const pending = this.pending.get(parentId);
    if (!pending) return;
    const cb = pending.callbacks;

    if (t === 'status') {
      const state = c.execution_state as string | undefined;
      if (state === 'busy' || state === 'idle' || state === 'dead') {
        cb.onStatus?.(state);
      }
    } else if (t === 'stream') {
      const name = c.name === 'stderr' ? 'stderr' : 'stdout';
      cb.onStream?.({ name, text: String(c.text ?? '') });
    } else if (t === 'display_data') {
      cb.onDisplayData?.({ data: (c.data ?? {}) as MimeBundle });
    } else if (t === 'execute_result') {
      cb.onExecuteResult?.({
        data: (c.data ?? {}) as MimeBundle,
        executionCount: typeof c.execution_count === 'number' ? c.execution_count : null,
      });
    } else if (t === 'error') {
      cb.onError?.({
        ename: String(c.ename ?? 'Error'),
        evalue: String(c.evalue ?? ''),
        traceback: Array.isArray(c.traceback) ? (c.traceback as unknown[]).map(String) : [],
      });
    } else if (t === 'execute_reply' && msg.channel === 'shell') {
      const status = c.status as string;
      const norm: 'ok' | 'error' | 'aborted' =
        status === 'ok' || status === 'error' || status === 'aborted' ? status : 'aborted';
      pending.resolve(norm);
      this.pending.delete(parentId);
    }
  }

  /** Send execute_request. Throws if no kernel is running.
   *  Returns a handle whose `done` resolves on execute_reply. */
  execute(code: string, callbacks: ExecuteCallbacks = {}): ExecuteHandle {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('execute: not connected');
    }
    const msgId = uuid();
    const msg = {
      header: {
        msg_id: msgId,
        session: this.session,
        username: 'eigendeck',
        msg_type: 'execute_request',
        version: '5.3',
        date: new Date().toISOString(),
      },
      parent_header: {},
      metadata: {},
      content: {
        code, silent: false, store_history: true,
        user_expressions: {}, allow_stdin: false, stop_on_error: true,
      },
      buffers: [],
      channel: 'shell',
    };
    let resolve!: (s: 'ok' | 'error' | 'aborted') => void;
    const done = new Promise<'ok' | 'error' | 'aborted'>((r) => { resolve = r; });
    this.pending.set(msgId, { resolve, callbacks });
    this.ws.send(JSON.stringify(msg));
    return {
      msgId,
      done,
      interrupt: () => this.interrupt(),
    };
  }

  /** POST /api/kernels/:id/interrupt — sends SIGINT-equivalent. */
  async interrupt(): Promise<void> {
    if (!this.kernel) return;
    await fetch(`${this.baseUrl}/api/kernels/${this.kernel.id}/interrupt${this.authQuery()}`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  /** DELETE /api/kernels/:id and close the WS. Safe to call any time. */
  async stopKernel(): Promise<void> {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    if (this.kernel) {
      try {
        await fetch(`${this.baseUrl}/api/kernels/${this.kernel.id}${this.authQuery()}`, {
          method: 'DELETE',
          headers: this.authHeaders(),
        });
      } catch { /* server unreachable — kernel will time out server-side */ }
      this.kernel = null;
    }
  }
}
