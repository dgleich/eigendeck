// Embedded-video providers (YouTube / Vimeo / PeerTube): URL parsing, iframe
// src construction (options are best-effort and per-provider), and poster
// thumbnails (YouTube = direct CDN URL; Vimeo/PeerTube = oEmbed lookup).

export type VideoProvider = 'youtube' | 'vimeo' | 'peertube';

export interface ParsedEmbed {
  provider: VideoProvider;
  id: string;        // video id / short-uuid
  origin?: string;   // PeerTube instance origin (also the embed base)
}

/** Detect a supported provider from a pasted URL; null if unrecognized. */
export function detectVideoProvider(raw: string): ParsedEmbed | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v) return { provider: 'youtube', id: v };
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
    if (m) return { provider: 'youtube', id: m[1] };
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) return { provider: 'youtube', id };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d+)/);
    if (m) return { provider: 'vimeo', id: m[1] };
  }
  // PeerTube (federated): /w/<id>, /videos/watch/<uuid>, /videos/embed/<uuid>.
  const pt = u.pathname.match(/\/(?:w|videos\/(?:watch|embed))\/([\w-]+)/);
  if (pt) return { provider: 'peertube', id: pt[1], origin: u.origin };
  return null;
}

type EmbedOpts = {
  provider?: string; url?: string;
  loop?: boolean; autoplay?: boolean; muted?: boolean; controls?: boolean; captions?: boolean;
};

/** Build the iframe src for an embed, applying the element's options. Per
 *  provider + best-effort: loop/autoplay/muted/controls/captions are URL
 *  params; playback SPEED has no reliable URL param (needs each provider's JS
 *  API) so it's omitted here. Autoplay forces mute (browser autoplay policy). */
export function buildEmbedSrc(el: EmbedOpts): string | null {
  if (!el.url) return null;
  const parsed = detectVideoProvider(el.url);
  if (!parsed) return null;
  const { provider, id, origin } = parsed;
  const p = new URLSearchParams();

  if (provider === 'youtube') {
    if (el.autoplay) { p.set('autoplay', '1'); p.set('mute', '1'); }
    if (el.muted) p.set('mute', '1');
    if (el.loop) { p.set('loop', '1'); p.set('playlist', id); }  // single-video loop needs playlist=id
    p.set('controls', el.controls ? '1' : '0');
    if (el.captions) p.set('cc_load_policy', '1');
    p.set('rel', '0');
    return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
  }
  if (provider === 'vimeo') {
    if (el.autoplay) { p.set('autoplay', '1'); p.set('muted', '1'); }
    if (el.muted) p.set('muted', '1');
    if (el.loop) p.set('loop', '1');
    if (!el.controls) p.set('controls', '0');
    if (el.captions) p.set('texttrack', 'en');
    return `https://player.vimeo.com/video/${id}?${p.toString()}`;
  }
  // PeerTube
  const base = origin ?? (() => { try { return new URL(el.url!).origin; } catch { return ''; } })();
  if (!base) return null;
  if (el.autoplay) { p.set('autoplay', '1'); p.set('muted', '1'); }
  if (el.muted) p.set('muted', '1');
  if (el.loop) p.set('loop', '1');
  if (!el.controls) p.set('controls', '0');
  if (el.captions) p.set('subtitle', 'en');
  return `${base}/videos/embed/${id}?${p.toString()}`;
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
