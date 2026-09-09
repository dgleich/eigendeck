import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installCoverageBeacon } from './coverageBeacon';

type CovWindow = Window & {
  __coverage__?: unknown;
  __covBeaconInstalled?: boolean;
  __covFlush?: () => Promise<void>;
};
const w = window as unknown as CovWindow;

describe('installCoverageBeacon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete w.__coverage__;
    delete w.__covBeaconInstalled;
    delete w.__covFlush;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a no-op when the page is not instrumented', () => {
    installCoverageBeacon();
    expect(w.__covBeaconInstalled).toBeUndefined();
    expect(w.__covFlush).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes __covFlush that POSTs the current coverage map', async () => {
    w.__coverage__ = { 'src/a.ts': { s: { 0: 1 } } };
    installCoverageBeacon();
    expect(typeof w.__covFlush).toBe('function');
    await w.__covFlush!();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('/__coverage__?id=')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ 'src/a.ts': { s: { 0: 1 } } });
  });

  it('__covFlush resolves even when the collector is unreachable', async () => {
    w.__coverage__ = {};
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    installCoverageBeacon();
    await expect(w.__covFlush!()).resolves.toBeUndefined();
  });

  it('installs only once per page', () => {
    w.__coverage__ = {};
    installCoverageBeacon();
    const first = w.__covFlush;
    installCoverageBeacon();
    expect(w.__covFlush).toBe(first);
  });
});
