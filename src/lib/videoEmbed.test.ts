import { describe, it, expect } from 'vitest';
import { detectVideoProvider, buildEmbedSrc, youtubeThumb } from './videoEmbed';

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
  });
  it('Vimeo: player URL with loop/controls', () => {
    const src = buildEmbedSrc({ provider: 'vimeo', url: 'https://vimeo.com/42', loop: true })!;
    expect(src.startsWith('https://player.vimeo.com/video/42?')).toBe(true);
    expect(src).toContain('loop=1');
    expect(src).toContain('controls=0');  // controls default off
  });
  it('PeerTube: embed URL on the instance origin', () => {
    const src = buildEmbedSrc({ provider: 'peertube', url: 'https://framatube.org/w/xyz', muted: true })!;
    expect(src.startsWith('https://framatube.org/videos/embed/xyz?')).toBe(true);
    expect(src).toContain('muted=1');
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
