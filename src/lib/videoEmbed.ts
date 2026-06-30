// Embedded-video providers (YouTube / Vimeo / PeerTube): URL parsing, iframe
// src construction (options are best-effort and per-provider), and poster
// thumbnails (YouTube = direct CDN URL; Vimeo/PeerTube = oEmbed lookup).

export type VideoProvider = 'youtube' | 'vimeo' | 'peertube';

// URL parsing AND the iframe-src builder are shared with the static export
// (exportCore.mjs) via a .mjs so there's a single copy; re-exported here so
// existing importers are unaffected. The live app calls buildEmbedSrc(el) (jsApi
// defaults on → enablejsapi/api for postMessage speed control); the static export
// passes { jsApi: false } (no JS to drive it).
export type { ParsedEmbed } from './videoEmbedParse.mjs';
export { detectVideoProvider, buildEmbedSrc, DEMO_SANDBOX, VIDEO_EMBED_ALLOW } from './videoEmbedParse.mjs';
import { detectVideoProvider } from './videoEmbedParse.mjs';

/** Best-effort playback-speed control for an embed, via each provider's
 *  postMessage player API (YouTube IFrame API / Vimeo player.js / PeerTube
 *  PlayerAPI). No-op/silent if the player isn't ready or the provider rejects
 *  it — speed is "best-effort" for embeds. */
export function postEmbedSpeed(win: Window | null | undefined, provider: string | undefined, rate: number): void {
  if (!win || !provider) return;
  try {
    if (provider === 'youtube') {
      win.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [rate] }), '*');
    } else if (provider === 'vimeo') {
      win.postMessage({ method: 'setPlaybackRate', value: rate }, '*');
    } else if (provider === 'peertube') {
      win.postMessage({ method: 'setPlaybackRate', params: [rate] }, '*');
    }
  } catch { /* cross-origin / not ready — ignore */ }
}

/** YouTube poster — a direct CDN URL (no API/CORS needed for <img> display). */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Resolve a poster thumbnail URL for any provider. YouTube is synchronous (a
 *  CDN URL); Vimeo/PeerTube need an oEmbed fetch (CORS-permitting; null on
 *  failure/offline). Returns a URL for <img src> display — not bytes. */
export async function fetchEmbedThumbnail(el: { provider?: string; url?: string }): Promise<string | null> {
  if (!el.url) return null;
  const parsed = detectVideoProvider(el.url);
  if (!parsed) return null;
  if (parsed.provider === 'youtube') return youtubeThumb(parsed.id);
  try {
    const oembed = parsed.provider === 'vimeo'
      ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(el.url)}`
      : `${parsed.origin}/services/oembed?format=json&url=${encodeURIComponent(el.url)}`;
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const j = await res.json();
    return (j && typeof j.thumbnail_url === 'string') ? j.thumbnail_url : null;
  } catch {
    return null;
  }
}
