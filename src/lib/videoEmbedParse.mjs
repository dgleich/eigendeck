// Shared YouTube / Vimeo / PeerTube URL → {provider, id, origin?} parser AND the
// iframe-src builder. Extracted so the live app (videoEmbed.ts) and the static
// export (exportCore.mjs) share ONE copy instead of two hand-synced ones. The
// builders' one intentional difference — the live embeds add enablejsapi/api for
// postMessage playback control, the static export omits them (no JS) — is now a
// `jsApi` flag, not a forked function.
export function detectVideoProvider(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
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

/**
 * Build the iframe `src` for an embed-kind video, applying the element's options
 * (loop/autoplay/muted/controls/captions as URL params; playback SPEED needs the
 * provider JS API, not a URL param). Returns null when the URL isn't a recognized
 * provider. `opts.jsApi` (default true) adds enablejsapi (YouTube) / api=1
 * (PeerTube) so postMessage can drive playback rate — the live app wants it; the
 * static HTML export passes `{ jsApi: false }` (no JS to drive it).
 *
 * showControls: hiding controls is only safe when autoplay starts the video —
 * with autoplay off, controls=0 leaves no way to play (and on PeerTube/video.js
 * also kills click-to-play). So controls show unless autoplay is on.
 */
export function buildEmbedSrc(el, opts = {}) {
  const jsApi = opts.jsApi !== false;
  if (!el || !el.url) return null;
  const parsed = detectVideoProvider(el.url);
  if (!parsed) return null;
  const { provider, id, origin } = parsed;
  const p = new URLSearchParams();
  const showControls = !!el.controls || !el.autoplay;

  if (provider === 'youtube') {
    if (el.autoplay) p.set('autoplay', '1');
    if (el.muted) p.set('mute', '1');
    if (el.loop) { p.set('loop', '1'); p.set('playlist', id); }  // single-video loop needs playlist=id
    p.set('controls', showControls ? '1' : '0');
    if (el.captions) p.set('cc_load_policy', '1');
    if (jsApi) p.set('enablejsapi', '1');  // postMessage control (setPlaybackRate)
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
  const base = origin ?? (() => { try { return new URL(el.url).origin; } catch { return ''; } })();
  if (!base) return null;
  if (el.autoplay) p.set('autoplay', '1');
  if (el.muted) p.set('muted', '1');
  if (el.loop) p.set('loop', '1');
  if (!showControls) p.set('controls', '0');
  if (el.captions) p.set('subtitle', 'en');
  if (jsApi) p.set('api', '1');  // PeerTube PlayerAPI (postMessage setPlaybackRate)
  return `${base}/videos/embed/${id}?${p.toString()}`;
}
