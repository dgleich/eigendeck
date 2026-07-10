import { describe, it, expect, vi } from 'vitest';
import { registerOverlayFlush, flushAllOverlays } from './overlayFlushRegistry';

describe('overlayFlushRegistry (#123)', () => {
  it('flushAllOverlays calls every registered flusher', async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    const offA = registerOverlayFlush(a);
    const offB = registerOverlayFlush(b);
    await flushAllOverlays();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA(); offB();
  });

  it('unregister removes the flusher', async () => {
    const a = vi.fn(async () => {});
    const off = registerOverlayFlush(a);
    off();
    await flushAllOverlays();
    expect(a).not.toHaveBeenCalled();
  });

  it('one failing flusher does not block the others', async () => {
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => { throw new Error('boom'); });
    const offGood = registerOverlayFlush(good);
    const offBad = registerOverlayFlush(bad);
    await expect(flushAllOverlays()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    offGood(); offBad();
  });
});
