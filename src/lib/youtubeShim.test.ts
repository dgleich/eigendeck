import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { liveEmbedSrc } from './youtubeShim';

// The Tauri boundary. liveEmbedSrc never touches it; the hook does. A hoisted
// mutable mock lets the per-test dynamic re-imports (needed to reset the
// module-level shim-base cache) share one controllable invoke.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const SHIM = 'http://127.0.0.1:54321/yt/tok123';
const YT_ID = 'dQw4w9WgXcQ'; // canonical 11-char id
const YT_WATCH = `https://www.youtube.com/watch?v=${YT_ID}`;
const YT_SHORT = `https://youtu.be/${YT_ID}`;
const VIMEO = 'https://vimeo.com/123456789';

// Parse a shim URL into { id, params } so assertions don't depend on query order.
function parseShim(url: string) {
  const u = new URL(url);
  // strip the trailing /<id> segment — the remaining prefix must be the shim base
  expect(u.origin + u.pathname.replace(/\/[^/]+$/, '')).toBe(SHIM);
  const id = u.pathname.split('/').pop();
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return { id, params };
}

describe('liveEmbedSrc', () => {
  it('routes a YouTube watch URL through the shim with no flags → no query string', () => {
    const out = liveEmbedSrc({ url: YT_WATCH }, SHIM);
    expect(out).toBe(`${SHIM}/${YT_ID}`);
  });

  it('routes a youtu.be short URL through the shim', () => {
    const out = liveEmbedSrc({ url: YT_SHORT }, SHIM);
    expect(out).toBe(`${SHIM}/${YT_ID}`);
  });

  it('maps every element flag to its shim query param', () => {
    const out = liveEmbedSrc(
      { url: YT_WATCH, autoplay: true, muted: true, loop: true, controls: true, captions: true },
      SHIM,
    )!;
    const { id, params } = parseShim(out);
    expect(id).toBe(YT_ID);
    expect(params).toEqual({ autoplay: '1', mute: '1', loop: '1', controls: '1', captions: '1' });
  });

  it('emits only the flags that are set (partial)', () => {
    const out = liveEmbedSrc({ url: YT_WATCH, autoplay: true }, SHIM)!;
    expect(parseShim(out).params).toEqual({ autoplay: '1' });
  });

  it('passes controls RAW to the shim (unlike buildEmbedSrc, no autoplay-derived default)', () => {
    // autoplay off + controls unset: buildEmbedSrc would force controls=1, but the
    // shim path forwards raw flags (Rust derives showControls). So NO controls param.
    const out = liveEmbedSrc({ url: YT_WATCH }, SHIM)!;
    expect('controls' in parseShim(out).params).toBe(false);
  });

  it('does NOT set loop playlist=id on the shim path (raw flag only)', () => {
    const out = liveEmbedSrc({ url: YT_WATCH, loop: true }, SHIM)!;
    const { params } = parseShim(out);
    expect(params).toEqual({ loop: '1' });
    expect('playlist' in params).toBe(false);
  });

  it('falls back to the direct embed when shimBase is empty', () => {
    const out = liveEmbedSrc({ url: YT_WATCH }, '');
    expect(out).toContain('youtube-nocookie.com/embed/' + YT_ID);
    expect(out).not.toContain('127.0.0.1');
  });

  it('does NOT shim non-YouTube providers even when shimBase is set', () => {
    const out = liveEmbedSrc({ url: VIMEO }, SHIM);
    expect(out).toContain('player.vimeo.com/video/123456789');
    expect(out).not.toContain('127.0.0.1');
  });

  it('returns null (via buildEmbedSrc) for a null element', () => {
    expect(liveEmbedSrc(null as never, SHIM)).toBeNull();
  });

  it('returns null for an element with no url', () => {
    expect(liveEmbedSrc({} as never, SHIM)).toBeNull();
  });

  it('falls through to buildEmbedSrc (null) for an unparseable url even with a shim', () => {
    expect(liveEmbedSrc({ url: 'not a url' }, SHIM)).toBeNull();
  });

  it('falls through for a YouTube host but non-canonical id (11-char guard)', () => {
    // id too short → detectVideoProvider returns null → buildEmbedSrc → null
    expect(liveEmbedSrc({ url: 'https://www.youtube.com/watch?v=short' }, SHIM)).toBeNull();
  });
});

// --- useYoutubeShimBase / fetchShimBase --------------------------------------
// The module caches the resolved base at module scope, so each scenario runs in
// a freshly reset module. We stub `location` to drive shimApplies().
describe('useYoutubeShimBase', () => {
  let renderHook: typeof import('@testing-library/react').renderHook;
  let waitFor: typeof import('@testing-library/react').waitFor;
  let act: typeof import('@testing-library/react').act;

  beforeEach(async () => {
    vi.resetModules();
    invokeMock.mockReset();
    ({ renderHook, waitFor, act } = await import('@testing-library/react'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function load() {
    return (await import('./youtubeShim')).useYoutubeShimBase;
  }

  it('resolves to "" and never calls the backend when the shim does not apply (http)', async () => {
    vi.stubGlobal('location', { protocol: 'http:' });
    const useHook = await load();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(result.current).toBe(''));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('fetches and returns the loopback base under the tauri: scheme', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    invokeMock.mockResolvedValue(SHIM);
    const useHook = await load();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(result.current).toBe(SHIM));
    expect(invokeMock).toHaveBeenCalledWith('youtube_shim_base');
  });

  it('coerces a backend failure to "" (catch path)', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    invokeMock.mockRejectedValue(new Error('no shim'));
    const useHook = await load();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    // stays '' (initial + resolved)
    expect(result.current).toBe('');
  });

  it('coerces an empty backend result to ""', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    invokeMock.mockResolvedValue('');
    const useHook = await load();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(result.current).toBe('');
  });

  it('treats a thrown location access as shim-not-applicable', async () => {
    // location getter throws → shimApplies() catch → false → base ''
    vi.stubGlobal('location', {
      get protocol(): string { throw new Error('boom'); },
    });
    const useHook = await load();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(result.current).toBe(''));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('caches the base: a second mount does not re-invoke the backend', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    invokeMock.mockResolvedValue(SHIM);
    const useHook = await load();

    const first = renderHook(() => useHook());
    await waitFor(() => expect(first.result.current).toBe(SHIM));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Second mount in the SAME module instance: served from cache, no new invoke,
    // and the initial render already carries the cached value.
    const second = renderHook(() => useHook());
    expect(second.result.current).toBe(SHIM);
    await act(async () => {}); // flush any effect
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw if the component unmounts before the fetch resolves', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    let resolve!: (v: string) => void;
    invokeMock.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const useHook = await load();
    const { unmount } = renderHook(() => useHook());
    unmount();
    // resolve after unmount — the `alive` guard must swallow the setState
    await act(async () => { resolve(SHIM); });
    // no unhandled error / act warning => pass
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
