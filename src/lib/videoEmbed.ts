// Embedded-video providers (YouTube / Vimeo / PeerTube): URL parsing, iframe
// src construction (options are best-effort and per-provider), and poster
// thumbnails (YouTube = direct CDN URL; Vimeo/PeerTube = oEmbed lookup).

export type VideoProvider = 'youtube' | 'vimeo' | 'peertube';

// URL parsing is shared with the static export (exportCore.mjs) via a .mjs so
// there's a single copy; re-exported here so existing importers are unaffected.
export type { ParsedEmbed } from './videoEmbedParse.mjs';
import { detectVideoProvider } from './videoEmbedParse.mjs';
export { detectVideoProvider };

type EmbedOpts = {
  provider?: string; url?: string;
  loop?: boolean; autoplay?: boolean; muted?: boolean; controls?: boolean; captions?: boolean;
};

/** Build the iframe src for an embed, applying the element's options. Per
 *  provider + best-effort: loop/autoplay/muted/controls/captions are URL
 *  params; playback SPEED has no reliable URL param (needs each provider's JS
 *  API) so it's omitted here. Mute follows the `muted` option only — autoplay
 *  does NOT force mute, because the app's webview is configured to allow
 *  autoplay with sound (wry sets WebKitGTK AutoplayPolicy::Allow / macOS
 *  mediaTypesRequiringUserActionForPlayback=None), unlike a normal web page.
 *  (YouTube's own player may still mute autoplay; PeerTube/Vimeo honor sound.) */
export function buildEmbedSrc(el: EmbedOpts): string | null {
  if (!el.url) return null;
  const parsed = detectVideoProvider(el.url);
  if (!parsed) return null;
  const { provider, id, origin } = parsed;
  const p = new URLSearchParams();

  // Hiding controls is only safe when autoplay starts the video for the user.
  // With autoplay off, controls=0 leaves NO way to start playback — on
  // PeerTube (video.js) it also hides the big play button and disables
  // click-to-play, so a default embed (controls off + autoplay off) is dead.
  // So: show controls unless autoplay is on. The "controls" toggle still hides
  // chrome for the autoplay case; for the play-on-click case it's overridden
  // to keep the embed usable.
  const showControls = !!el.controls || !el.autoplay;

  if (provider === 'youtube') {
    if (el.autoplay) p.set('autoplay', '1');
    if (el.muted) p.set('mute', '1');
    if (el.loop) { p.set('loop', '1'); p.set('playlist', id); }  // single-video loop needs playlist=id
    p.set('controls', showControls ? '1' : '0');
    if (el.captions) p.set('cc_load_policy', '1');
    p.set('enablejsapi', '1');  // enable postMessage control (setPlaybackRate)
    p.set('rel', '0');
    return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
  }
  if (provider === 'vimeo') {
    if (el.autoplay) p.set('autoplay', '1');
    if (el.muted) p.set('muted', '1');
    if (el.loop) p.set('loop', '1');
    if (!showControls) p.set('controls', '0');
    if (el.captions) p.set('texttrack', 'en');
    return `https://player.vimeo.com/video/${id}?${p.toString()}`;
  }
  // PeerTube
  const base = origin ?? (() => { try { return new URL(el.url!).origin; } catch { return ''; } })();
  if (!base) return null;
  if (el.autoplay) p.set('autoplay', '1');
  if (el.muted) p.set('muted', '1');
  if (el.loop) p.set('loop', '1');
  if (!showControls) p.set('controls', '0');
  if (el.captions) p.set('subtitle', 'en');
  p.set('api', '1');  // enable the PeerTube PlayerAPI (postMessage setPlaybackRate)
  return `${base}/videos/embed/${id}?${p.toString()}`;
}

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
