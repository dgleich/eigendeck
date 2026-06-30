import { describe, it, expect } from 'vitest';
import { detectVideoProvider } from './videoEmbedParse.mjs';

// @simplify-guard — pins the shared video-URL parser extracted from the two
// byte-identical copies (videoEmbed.ts + exportCore.mjs). Safe to prune once the
// shared parser is trusted.
describe('[simplify-guard] detectVideoProvider', () => {
  it('youtube watch / youtu.be / embed / shorts', () => {
    expect(detectVideoProvider('https://www.youtube.com/watch?v=abc123')).toEqual({ provider: 'youtube', id: 'abc123' });
    expect(detectVideoProvider('https://youtu.be/xyz789')).toEqual({ provider: 'youtube', id: 'xyz789' });
    expect(detectVideoProvider('https://youtube.com/embed/EMB12')).toEqual({ provider: 'youtube', id: 'EMB12' });
    expect(detectVideoProvider('https://www.youtube.com/shorts/SH0rt')).toEqual({ provider: 'youtube', id: 'SH0rt' });
  });
  it('vimeo', () => {
    expect(detectVideoProvider('https://vimeo.com/123456')).toEqual({ provider: 'vimeo', id: '123456' });
    expect(detectVideoProvider('https://player.vimeo.com/video/987654')).toEqual({ provider: 'vimeo', id: '987654' });
  });
  it('peertube (/w and /videos/watch) carries origin', () => {
    expect(detectVideoProvider('https://tube.example.org/w/Wuuid1')).toEqual({ provider: 'peertube', id: 'Wuuid1', origin: 'https://tube.example.org' });
    expect(detectVideoProvider('https://tube.example.org/videos/watch/V2uuid')).toEqual({ provider: 'peertube', id: 'V2uuid', origin: 'https://tube.example.org' });
  });
  it('strips www, trims, and rejects junk', () => {
    expect(detectVideoProvider('  https://www.youtube.com/watch?v=trimmed  ')).toEqual({ provider: 'youtube', id: 'trimmed' });
    expect(detectVideoProvider('not a url')).toBeNull();
    expect(detectVideoProvider('https://example.com/nope')).toBeNull();
  });
});
