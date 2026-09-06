// Unit tests for serverDiscovery: the background auto-discovery that
// probes every registered Jupyter server's /api/kernelspecs and writes
// fresh availableKernels + lastSeenAt back into preferences. The
// preferences boundary (getPreference/setPreference) is fully mocked and
// global fetch is stubbed; these tests exercise the module's own logic —
// URL/token building, the ok/not-ok/throw branches of the per-server
// probe, the parallel fan-out, and the change-detection gate on the write.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JupyterServerEntry } from './preferences';

vi.mock('./preferences', () => ({
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));

import { getPreference, setPreference } from './preferences';
import { discoverAllServers } from './serverDiscovery';

const getPref = getPreference as unknown as ReturnType<typeof vi.fn>;
const setPref = setPreference as unknown as ReturnType<typeof vi.fn>;

function server(overrides: Partial<JupyterServerEntry> = {}): JupyterServerEntry {
  return {
    label: 'local',
    baseUrl: 'http://localhost:8888',
    token: 'tok',
    ...overrides,
  };
}

/** Build a fetch Response-ish object. */
function okResponse(kernelspecs: Record<string, unknown>): Partial<Response> {
  return { ok: true, json: async () => ({ kernelspecs }) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  getPref.mockReset();
  setPref.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discoverAllServers', () => {
  it('does nothing when no servers are registered', async () => {
    getPref.mockReturnValue([]);
    await discoverAllServers();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setPref).not.toHaveBeenCalled();
  });

  it('probes /api/kernelspecs and writes fresh kernels + lastSeenAt', async () => {
    getPref.mockReturnValue([server()]);
    fetchMock.mockResolvedValue(okResponse({ python3: {}, 'julia-1.10': {} }));

    const before = Date.now();
    await discoverAllServers();
    const after = Date.now();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls as unknown[][])[0];
    expect(url).toBe('http://localhost:8888/api/kernelspecs?token=tok');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'token tok' });

    expect(setPref).toHaveBeenCalledTimes(1);
    const [key, value] = (setPref.mock.calls as unknown[][])[0];
    expect(key).toBe('jupyterServers');
    const written = value as JupyterServerEntry[];
    expect(written[0].availableKernels).toEqual(['python3', 'julia-1.10']);
    expect(written[0].lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(written[0].lastSeenAt).toBeLessThanOrEqual(after);
  });

  it('strips a trailing slash from baseUrl and encodes the token', async () => {
    getPref.mockReturnValue([server({ baseUrl: 'http://h:9/', token: 'a b/c' })]);
    fetchMock.mockResolvedValue(okResponse({ python3: {} }));
    await discoverAllServers();
    const [url] = (fetchMock.mock.calls as unknown[][])[0];
    expect(url).toBe('http://h:9/api/kernelspecs?token=a%20b%2Fc');
  });

  it('sends no token query or auth header when token is empty', async () => {
    getPref.mockReturnValue([server({ token: '' })]);
    fetchMock.mockResolvedValue(okResponse({ python3: {} }));
    await discoverAllServers();
    const [url, init] = (fetchMock.mock.calls as unknown[][])[0];
    expect(url).toBe('http://localhost:8888/api/kernelspecs');
    expect((init as RequestInit).headers).toEqual({});
  });

  it('treats a missing kernelspecs field as an empty kernel list', async () => {
    getPref.mockReturnValue([server({ availableKernels: ['stale'] })]);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Partial<Response>);
    await discoverAllServers();
    const written = (setPref.mock.calls as unknown[][])[0][1] as JupyterServerEntry[];
    expect(written[0].availableKernels).toEqual([]);
  });

  it('leaves an entry untouched on a non-ok response (and writes nothing if unchanged)', async () => {
    getPref.mockReturnValue([server({ availableKernels: ['python3'], lastSeenAt: 111 })]);
    fetchMock.mockResolvedValue({ ok: false } as Partial<Response>);
    await discoverAllServers();
    expect(setPref).not.toHaveBeenCalled();
  });

  it('leaves an entry untouched when fetch throws', async () => {
    getPref.mockReturnValue([server({ availableKernels: ['python3'], lastSeenAt: 222 })]);
    fetchMock.mockRejectedValue(new Error('network down'));
    await discoverAllServers();
    expect(setPref).not.toHaveBeenCalled();
  });

  it('leaves an entry untouched when json parsing throws', async () => {
    getPref.mockReturnValue([server({ availableKernels: ['python3'], lastSeenAt: 333 })]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    } as Partial<Response>);
    await discoverAllServers();
    expect(setPref).not.toHaveBeenCalled();
  });

  it('probes every server in parallel and writes once for the whole batch', async () => {
    getPref.mockReturnValue([
      server({ label: 'a', baseUrl: 'http://a:8888' }),
      server({ label: 'b', baseUrl: 'http://b:8888' }),
    ]);
    fetchMock.mockImplementation(async (u: string) =>
      u.startsWith('http://a') ? okResponse({ python3: {} }) : okResponse({ ir: {} }),
    );
    await discoverAllServers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setPref).toHaveBeenCalledTimes(1);
    const written = (setPref.mock.calls as unknown[][])[0][1] as JupyterServerEntry[];
    expect(written[0].availableKernels).toEqual(['python3']);
    expect(written[1].availableKernels).toEqual(['ir']);
  });

  it('writes when only one of several servers actually changed', async () => {
    getPref.mockReturnValue([
      server({ label: 'reachable', baseUrl: 'http://a:8888' }),
      server({ label: 'dead', baseUrl: 'http://b:8888', availableKernels: ['python3'], lastSeenAt: 5 }),
    ]);
    fetchMock.mockImplementation(async (u: string) =>
      u.startsWith('http://a')
        ? okResponse({ python3: {} })
        : ({ ok: false } as Partial<Response>),
    );
    await discoverAllServers();
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('does not write when the kernel list is identical and only lastSeenAt would move — actually it does, because lastSeenAt refreshes', async () => {
    // A successful probe always bumps lastSeenAt, so change-detection fires
    // even when the kernel set is unchanged. This documents that branch.
    getPref.mockReturnValue([server({ availableKernels: ['python3'], lastSeenAt: 1 })]);
    fetchMock.mockResolvedValue(okResponse({ python3: {} }));
    await discoverAllServers();
    expect(setPref).toHaveBeenCalledTimes(1);
    const written = (setPref.mock.calls as unknown[][])[0][1] as JupyterServerEntry[];
    expect(written[0].lastSeenAt).not.toBe(1);
    expect(written[0].availableKernels).toEqual(['python3']);
  });
});
