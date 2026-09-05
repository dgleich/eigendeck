import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';

// Mock the postMessage boundary so useEmbedSpeed can be observed without a real iframe.
vi.mock('./videoEmbed', () => ({ postEmbedSpeed: vi.fn() }));

import { togglePlay, useEmbedSpeed, usePlaybackRate, usePingPong } from './videoPlayback';
import { postEmbedSpeed } from './videoEmbed';

const postSpy = vi.mocked(postEmbedSpeed);

/** A minimal <video> stand-in with the surface the module touches. */
function makeVideo(init: Partial<{ paused: boolean; currentTime: number; playbackRate: number }> = {}) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn(function (this: { paused: boolean }) { this.paused = true; });
  const v = {
    paused: init.paused ?? true,
    currentTime: init.currentTime ?? 0,
    playbackRate: init.playbackRate ?? 1,
    play,
    pause,
    addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
      let s = listeners.get(type);
      if (!s) { s = new Set(); listeners.set(type, s); }
      s.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
      listeners.get(type)?.delete(cb);
    }),
    dispatch(type: string) { listeners.get(type)?.forEach((cb) => cb({ type })); },
  };
  return v;
}

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

beforeEach(() => {
  postSpy.mockClear();
});

describe('togglePlay', () => {
  it('is a no-op for a null element', () => {
    expect(() => togglePlay(null)).not.toThrow();
  });

  it('plays a paused video', () => {
    const v = makeVideo({ paused: true });
    togglePlay(v as unknown as HTMLVideoElement);
    expect(v.play).toHaveBeenCalledTimes(1);
    expect(v.pause).not.toHaveBeenCalled();
  });

  it('pauses a playing video', () => {
    const v = makeVideo({ paused: false });
    togglePlay(v as unknown as HTMLVideoElement);
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(v.play).not.toHaveBeenCalled();
  });

  it('swallows a rejected play() promise', async () => {
    const v = makeVideo({ paused: true });
    v.play.mockReturnValueOnce(Promise.reject(new Error('not allowed')));
    expect(() => togglePlay(v as unknown as HTMLVideoElement)).not.toThrow();
    // Let the rejection settle to prove the .catch() handled it (no unhandled rejection).
    await Promise.resolve();
  });
});

describe('usePlaybackRate', () => {
  it('applies the rate to the video element', () => {
    const v = makeVideo();
    renderHook(() => usePlaybackRate(ref(v as unknown as HTMLVideoElement), 2, 'k'));
    expect(v.playbackRate).toBe(2);
  });

  it('falls back to 1 for a falsy rate', () => {
    const v = makeVideo({ playbackRate: 3 });
    renderHook(() => usePlaybackRate(ref(v as unknown as HTMLVideoElement), 0, 'k'));
    expect(v.playbackRate).toBe(1);
  });

  it('is a no-op when the ref is empty', () => {
    expect(() =>
      renderHook(() => usePlaybackRate(ref<HTMLVideoElement | null>(null), 2, 'k')),
    ).not.toThrow();
  });

  it('re-applies when the srcKey changes', () => {
    const v = makeVideo();
    const { rerender } = renderHook(
      ({ rate, key }: { rate: number; key: string }) =>
        usePlaybackRate(ref(v as unknown as HTMLVideoElement), rate, key),
      { initialProps: { rate: 2, key: 'a' } },
    );
    expect(v.playbackRate).toBe(2);
    v.playbackRate = 99; // simulate the browser resetting it on a src swap
    rerender({ rate: 2, key: 'b' });
    expect(v.playbackRate).toBe(2);
  });
});

describe('useEmbedSpeed', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const iframeRef = () => ref({ contentWindow: {} } as unknown as HTMLIFrameElement);

  it('does nothing without a provider', () => {
    renderHook(() => useEmbedSpeed(iframeRef(), undefined, 2, 'k'));
    vi.advanceTimersByTime(5000);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('does nothing at rate 1 (provider default)', () => {
    renderHook(() => useEmbedSpeed(iframeRef(), 'youtube', 1, 'k'));
    vi.advanceTimersByTime(5000);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('does nothing at a falsy rate', () => {
    renderHook(() => useEmbedSpeed(iframeRef(), 'youtube', 0, 'k'));
    vi.advanceTimersByTime(5000);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('posts the speed three times after load (600/1500/3000ms)', () => {
    renderHook(() => useEmbedSpeed(iframeRef(), 'vimeo', 1.5, 'k'));
    expect(postSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(postSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(900); // 1500 total
    expect(postSpy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1500); // 3000 total
    expect(postSpy).toHaveBeenCalledTimes(3);
    // Posts to the iframe's contentWindow with provider + rate.
    expect(postSpy).toHaveBeenLastCalledWith(expect.anything(), 'vimeo', 1.5);
  });

  it('clears pending timers on unmount', () => {
    const { unmount } = renderHook(() => useEmbedSpeed(iframeRef(), 'youtube', 2, 'k'));
    vi.advanceTimersByTime(600);
    expect(postSpy).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(postSpy).toHaveBeenCalledTimes(1); // the 1500 & 3000 timers were cancelled
  });
});

describe('usePingPong', () => {
  let rafCbs: FrameRequestCallback[];
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rafCbs = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length; // 1-based id
    }));
    cancelSpy = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);
    vi.stubGlobal('performance', { now: vi.fn(() => 0) });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not attach the ended listener when disabled', () => {
    const v = makeVideo();
    renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), false, 1, 'k'));
    expect(v.addEventListener).not.toHaveBeenCalled();
  });

  it('is a no-op with an empty ref', () => {
    expect(() =>
      renderHook(() => usePingPong(ref<HTMLVideoElement | null>(null), true, 1, 'k')),
    ).not.toThrow();
  });

  it('starts reverse-stepping on the ended event and seeks currentTime backward', () => {
    const v = makeVideo({ currentTime: 5 });
    renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), true, 1, 'k'));
    expect(v.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));

    v.dispatch('ended'); // schedules the first frame; last = performance.now() = 0
    expect(rafCbs).toHaveLength(1);

    rafCbs[0](1000); // dt = (1000 - 0)/1000 = 1s → currentTime = 5 - 1 = 4
    expect(v.currentTime).toBeCloseTo(4);
    expect(rafCbs).toHaveLength(2); // still above 0 → schedules another frame
    expect(v.play).not.toHaveBeenCalled();
  });

  it('scales the reverse step by the playback rate', () => {
    const v = makeVideo({ currentTime: 5 });
    renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), true, 2, 'k'));
    v.dispatch('ended');
    rafCbs[0](1000); // dt=1s at rate 2 → 5 - 2 = 3
    expect(v.currentTime).toBeCloseTo(3);
  });

  it('clamps at zero and plays forward again when back at the start', () => {
    const v = makeVideo({ currentTime: 0.5 });
    renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), true, 1, 'k'));
    v.dispatch('ended');
    rafCbs[0](1000); // 0.5 - 1 = -0.5 → clamped to 0 → <= 0.001 → play(), no reschedule
    expect(v.currentTime).toBe(0);
    expect(v.play).toHaveBeenCalledTimes(1);
    expect(rafCbs).toHaveLength(1); // did NOT schedule another frame
  });

  it('treats a falsy rate as 1 in the step', () => {
    const v = makeVideo({ currentTime: 5 });
    renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), true, 0, 'k'));
    v.dispatch('ended');
    rafCbs[0](1000); // rate||1 = 1 → 5 - 1 = 4
    expect(v.currentTime).toBeCloseTo(4);
  });

  it('bails out of a frame if the ref emptied mid-flight', () => {
    const r = ref(makeVideo({ currentTime: 5 }) as unknown as HTMLVideoElement);
    renderHook(() => usePingPong(r, true, 1, 'k'));
    const v = r.current as unknown as ReturnType<typeof makeVideo>;
    v.dispatch('ended');
    (r as { current: unknown }).current = null; // element torn down before the frame runs
    expect(() => rafCbs[0](1000)).not.toThrow();
    expect(v.currentTime).toBe(5); // untouched
  });

  it('removes the listener and cancels the frame on unmount', () => {
    const v = makeVideo({ currentTime: 5 });
    const { unmount } = renderHook(() => usePingPong(ref(v as unknown as HTMLVideoElement), true, 1, 'k'));
    v.dispatch('ended'); // schedule a frame so there is a raf id to cancel
    unmount();
    expect(v.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    expect(cancelSpy).toHaveBeenCalled();
  });
});
