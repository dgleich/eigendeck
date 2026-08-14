import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScreenWakeLock } from './useWakeLock';

const flush = () => new Promise((r) => setTimeout(r, 0));

function installWakeLock() {
  let releaseCb: (() => void) | undefined;
  const sentinel = {
    release: vi.fn(async () => {}),
    addEventListener: vi.fn((ev: string, cb: () => void) => { if (ev === 'release') releaseCb = cb; }),
  };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true, writable: true });
  return { request, sentinel, fireRelease: () => releaseCb?.() };
}
const removeWakeLock = () => { delete (navigator as unknown as { wakeLock?: unknown }).wakeLock; };

describe('useScreenWakeLock (#179)', () => {
  beforeEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
  afterEach(() => { removeWakeLock(); vi.restoreAllMocks(); });

  it('acquires a screen wake lock while active, releases on unmount', async () => {
    const wl = installWakeLock();
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    await flush();
    expect(wl.request).toHaveBeenCalledWith('screen');
    unmount();
    expect(wl.sentinel.release).toHaveBeenCalled();
  });

  it('does nothing when inactive', async () => {
    const wl = installWakeLock();
    renderHook(() => useScreenWakeLock(false));
    await flush();
    expect(wl.request).not.toHaveBeenCalled();
  });

  it('no-ops (does not throw) when the API is unavailable', async () => {
    removeWakeLock();
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
    await flush();
  });

  it('re-acquires after the OS releases the lock, on the next visibilitychange', async () => {
    const wl = installWakeLock();
    renderHook(() => useScreenWakeLock(true));
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(1);
    wl.fireRelease();                                    // OS dropped it → hook clears its handle
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(2);
  });

  it('does not double-acquire while the lock is still held', async () => {
    const wl = installWakeLock();
    renderHook(() => useScreenWakeLock(true));
    await flush();
    document.dispatchEvent(new Event('visibilitychange')); // still visible + still held
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(1);
  });
});
