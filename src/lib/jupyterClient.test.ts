// Regression guard for the connection-readiness handshake in JupyterClient.
//
// jupyter_server runs a "nudge" (a kernel_info handshake) on every new channels
// WebSocket and does NOT reliably deliver shell messages that arrive before it
// completes. Sending execute_request in ws.onopen therefore races that nudge and
// the first cell run is silently dropped. startKernel() must not resolve — and
// execute() must not be usable — until our own kernel_info_request is answered.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JupyterClient } from './jupyterClient';

interface SentMsg { header: { msg_id: string; msg_type: string }; channel: string }

// Minimal controllable WebSocket stand-in. Records sent frames and exposes the
// event hooks so the test can drive onopen / onmessage.
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0; static CLOSING = 2; static CLOSED = 3;
  readyState = 1; // OPEN — the client checks WebSocket.OPEN before send()
  url: string;
  protocol = '';
  sent: SentMsg[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  // test helpers
  open() { this.onopen?.(); }
  deliver(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  lastSent() { return this.sent[this.sent.length - 1]; }
  typesSent() { return this.sent.map((m) => m.header.msg_type); }
}

function mockKernelPost() {
  // JupyterClient uses fetch for POST /api/kernels only in this flow.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'kernel-1', name: 'python3' }),
    text: async () => '',
  })) as unknown as typeof fetch);
}

describe('JupyterClient connection-readiness handshake', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    mockKernelPost();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('sends kernel_info_request on open and does NOT resolve startKernel until the reply', async () => {
    const client = new JupyterClient({ baseUrl: 'http://h:8888', token: 't' });
    let resolved = false;
    const started = client.startKernel('python3').then(() => { resolved = true; });

    // let the POST /api/kernels promise settle so openChannels runs
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeTruthy();

    ws.open();
    // On open we must have sent exactly a kernel_info_request — never execute yet.
    expect(ws.typesSent()).toEqual(['kernel_info_request']);
    const infoId = ws.lastSent().header.msg_id;

    // startKernel is still pending — the channel isn't "ready".
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Answer the handshake → startKernel resolves.
    ws.deliver({ header: { msg_type: 'kernel_info_reply' }, parent_header: { msg_id: infoId }, channel: 'shell', content: {} });
    await started;
    expect(resolved).toBe(true);

    // Only now is execute usable, and it emits an execute_request.
    client.execute('print(1)');
    expect(ws.typesSent()).toEqual(['kernel_info_request', 'execute_request']);
  });

  it('surfaces execution_count via onReply for a cell with NO output', async () => {
    const client = new JupyterClient({ baseUrl: 'http://h:8888', token: '' });
    const started = client.startKernel('python3');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.deliver({ header: { msg_type: 'kernel_info_reply' }, parent_header: { msg_id: ws.lastSent().header.msg_id }, channel: 'shell', content: {} });
    await started;

    const replies: Array<{ status: string; executionCount: number | null }> = [];
    const results: unknown[] = [];
    const handle = client.execute('k = 5', {
      onExecuteResult: (r) => results.push(r),
      onReply: (r) => replies.push(r),
    });
    const execId = ws.lastSent().header.msg_id;
    // An assignment produces NO execute_result — only a shell execute_reply
    // carrying the count. onReply must still fire so the prompt gets its [N].
    ws.deliver({ header: { msg_type: 'execute_reply' }, parent_header: { msg_id: execId }, channel: 'shell', content: { status: 'ok', execution_count: 7 } });
    await handle.done;

    expect(results).toEqual([]);                                   // no execute_result
    expect(replies).toEqual([{ status: 'ok', executionCount: 7 }]); // count still delivered
  });

  it('a kernel_info_reply for a DIFFERENT request does not mark ready — only ours does', async () => {
    const client = new JupyterClient({ baseUrl: 'http://h:8888', token: 't' });
    let resolved = false;
    const started = client.startKernel('python3').then(() => { resolved = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const ourId = ws.lastSent().header.msg_id;

    // A stray kernel_info_reply parented to some OTHER msg id must be ignored.
    ws.deliver({ header: { msg_type: 'kernel_info_reply' }, parent_header: { msg_id: 'someone-else' }, channel: 'shell', content: {} });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Ours resolves it.
    ws.deliver({ header: { msg_type: 'kernel_info_reply' }, parent_header: { msg_id: ourId }, channel: 'shell', content: {} });
    await started;
    expect(resolved).toBe(true);
  });

  it('rejects startKernel if the WS closes before the kernel is ready', async () => {
    const client = new JupyterClient({ baseUrl: 'http://h:8888', token: 't' });
    const started = client.startKernel('python3');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    // Close before any kernel_info_reply arrives.
    ws.close();
    await expect(started).rejects.toThrow(/closed before the kernel was ready/);
  });

  it('falls back to ready after 5s if no kernel_info_reply arrives (never hangs)', async () => {
    vi.useFakeTimers();
    const client = new JupyterClient({ baseUrl: 'http://h:8888', token: '' });
    let resolved = false;
    const started = client.startKernel('python3').then(() => { resolved = true; });

    // flush the fetch microtasks under fake timers
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(ws.typesSent()).toEqual(['kernel_info_request']);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    await started;
    expect(resolved).toBe(true);
  });
});
