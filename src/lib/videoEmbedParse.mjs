// Shared YouTube / Vimeo / PeerTube URL → {provider, id, origin?} parser.
// Extracted so the live app (videoEmbed.ts) and the static export
// (exportCore.mjs) share ONE parser instead of two byte-identical copies. Only
// the PARSE is shared — the iframe-src BUILDERS differ on purpose (the live one
// adds enablejsapi/api for postMessage playback control; the export omits it).
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
