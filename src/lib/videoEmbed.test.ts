import { describe, it, expect } from 'vitest';
import { detectVideoProvider, buildEmbedSrc, youtubeThumb, postEmbedSpeed } from './videoEmbed';

describe('detectVideoProvider', () => {
  it('YouTube: watch / youtu.be / embed / shorts', () => {
    expect(detectVideoProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(detectVideoProvider('https://youtu.be/dQw4w9WgXcQ?t=10')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(detectVideoProvider('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(detectVideoProvider('https://youtube.com/shorts/abc123XYZ_-')).toEqual({ provider: 'youtube', id: 'abc123XYZ_-' });
  });
  it('Vimeo: vimeo.com/ID and player.vimeo.com', () => {
    expect(detectVideoProvider('https://vimeo.com/123456789')).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(detectVideoProvider('https://player.vimeo.com/video/123456789')).toEqual({ provider: 'vimeo', id: '123456789' });
  });
  it('PeerTube: /w/ and /videos/watch/ keep the instance origin', () => {
    expect(detectVideoProvider('https://framatube.org/w/abcDEF123')).toEqual({ provider: 'peertube', id: 'abcDEF123', origin: 'https://framatube.org' });
    expect(detectVideoProvider('https://tube.example.net/videos/watch/uuid-1234')).toEqual({ provider: 'peertube', id: 'uuid-1234', origin: 'https://tube.example.net' });
  });
  it('returns null for junk / unsupported', () => {
    expect(detectVideoProvider('not a url')).toBeNull();
    expect(detectVideoProvider('https://example.com/page')).toBeNull();
  });
});

describe('buildEmbedSrc', () => {
  it('YouTube: loop adds playlist=id; autoplay forces mute; controls/captions', () => {
    const src = buildEmbedSrc({ provider: 'youtube', url: 'https://youtu.be/ID12345', loop: true, autoplay: true, controls: true, captions: true })!;
    expect(src.startsWith('https://www.youtube-nocookie.com/embed/ID12345?')).toBe(true);
    expect(src).toContain('loop=1');
    expect(src).toContain('playlist=ID12345');
    expect(src).toContain('autoplay=1');
    expect(src).toContain('mute=1');
    expect(src).toContain('controls=1');
    expect(src).toContain('cc_load_policy=1');
    expect(src).toContain('enablejsapi=1');  // needed for postMessage setPlaybackRate
  });
  it('Vimeo: player URL; controls hidden only when autoplay starts it', () => {
    // autoplay on -> hiding controls is safe (video starts itself)
    const auto = buildEmbedSrc({ provider: 'vimeo', url: 'https://vimeo.com/42', loop: true, autoplay: true })!;
    expect(auto.startsWith('https://player.vimeo.com/video/42?')).toBe(true);
    expect(auto).toContain('loop=1');
    expect(auto).toContain('controls=0');
  });
  it('PeerTube: embed URL on the instance origin', () => {
    const src = buildEmbedSrc({ provider: 'peertube', url: 'https://framatube.org/w/xyz', muted: true })!;
    expect(src.startsWith('https://framatube.org/videos/embed/xyz?')).toBe(true);
    expect(src).toContain('muted=1');
    expect(src).toContain('api=1');  // enable the PeerTube PlayerAPI
  });
  // Regression: a default embed (controls off + autoplay off) must stay
  // PLAYABLE. PeerTube's controls=0 hides the big play button AND disables
  // click-to-play, so we must NOT emit controls=0 unless autoplay starts it.
  it('default embed (controls off, autoplay off) keeps controls so it is playable', () => {
    const pt = buildEmbedSrc({ provider: 'peertube', url: 'https://framatube.org/w/xyz' })!;
    expect(pt).not.toContain('controls=0');
    const vi = buildEmbedSrc({ provider: 'vimeo', url: 'https://vimeo.com/42' })!;
    expect(vi).not.toContain('controls=0');
    const yt = buildEmbedSrc({ provider: 'youtube', url: 'https://youtu.be/ID12345' })!;
    expect(yt).toContain('controls=1');
  });
  it('autoplay embed may hide controls (autoplay provides playback)', () => {
    const pt = buildEmbedSrc({ provider: 'peertube', url: 'https://framatube.org/w/xyz', autoplay: true })!;
    expect(pt).toContain('controls=0');
    const yt = buildEmbedSrc({ provider: 'youtube', url: 'https://youtu.be/ID12345', autoplay: true })!;
    expect(yt).toContain('controls=0');
  });
  it('controls explicitly on is always honored', () => {
    const pt = buildEmbedSrc({ provider: 'peertube', url: 'https://framatube.org/w/xyz', controls: true, autoplay: true })!;
    expect(pt).not.toContain('controls=0');
  });
  it('returns null for an unrecognized URL', () => {
    expect(buildEmbedSrc({ provider: 'youtube', url: 'https://example.com/x' })).toBeNull();
  });
});

describe('youtubeThumb', () => {
  it('is a direct CDN URL', () => {
    expect(youtubeThumb('ID')).toBe('https://i.ytimg.com/vi/ID/hqdefault.jpg');
  });
});

describe('postEmbedSpeed', () => {
  it('posts the provider-specific setPlaybackRate message', () => {
    const calls: any[] = [];
    const win = { postMessage: (m: any) => calls.push(m) } as unknown as Window;
    postEmbedSpeed(win, 'youtube', 1.5);
    postEmbedSpeed(win, 'vimeo', 1.5);
    postEmbedSpeed(win, 'peertube', 1.5);
    expect(JSON.parse(calls[0])).toMatchObject({ event: 'command', func: 'setPlaybackRate', args: [1.5] }); // YT: JSON string
    expect(calls[1]).toMatchObject({ method: 'setPlaybackRate', value: 1.5 });                              // Vimeo: object
    expect(calls[2]).toMatchObject({ method: 'setPlaybackRate', params: [1.5] });                           // PeerTube: object
  });
  it('is a no-op for null window / unknown provider', () => {
    expect(() => postEmbedSpeed(null, 'youtube', 1.5)).not.toThrow();
    const calls: any[] = [];
    postEmbedSpeed({ postMessage: (m: any) => calls.push(m) } as unknown as Window, 'unknown', 1.5);
    expect(calls.length).toBe(0);
  });
});
