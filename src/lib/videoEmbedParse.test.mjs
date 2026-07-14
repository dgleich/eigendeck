import { describe, it, expect } from 'vitest';
import { detectVideoProvider } from './videoEmbedParse.mjs';

// @simplify-guard — pins the shared video-URL parser extracted from the two
// byte-identical copies (videoEmbed.ts + exportCore.mjs). Safe to prune once the
// shared parser is trusted.
describe('[simplify-guard] detectVideoProvider', () => {
  it('youtube watch / youtu.be / embed / shorts (canonical 11-char ids)', () => {
    expect(detectVideoProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(detectVideoProvider('https://youtu.be/9bZkp7q19f0')).toEqual({ provider: 'youtube', id: '9bZkp7q19f0' });
    expect(detectVideoProvider('https://youtube.com/embed/kJQP7kiw5Fk')).toEqual({ provider: 'youtube', id: 'kJQP7kiw5Fk' });
    expect(detectVideoProvider('https://www.youtube.com/shorts/aBc-1_dEfGh')).toEqual({ provider: 'youtube', id: 'aBc-1_dEfGh' });
  });
  it('rejects malformed youtube ids (wrong length / injection chars) -> null', () => {
    expect(detectVideoProvider('https://www.youtube.com/watch?v=abc123')).toBeNull();        // too short
    expect(detectVideoProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQextra')).toBeNull(); // too long
    expect(detectVideoProvider('https://youtube.com/embed/abc"><script>x')).toBeNull();       // injection shape
    expect(detectVideoProvider('https://www.youtube.com/watch?v=')).toBeNull();               // empty
    expect(detectVideoProvider('https://youtu.be/short')).toBeNull();                          // too short
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
    expect(detectVideoProvider('  https://www.youtube.com/watch?v=trimmed_xyz  ')).toEqual({ provider: 'youtube', id: 'trimmed_xyz' });
    expect(detectVideoProvider('not a url')).toBeNull();
    expect(detectVideoProvider('https://example.com/nope')).toBeNull();
  });
});
