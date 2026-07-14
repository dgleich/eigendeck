// Frontend side of the YouTube loopback shim (docs/youtube-embed-shim.md).
//
// In the PACKAGED app the frontend origin is the custom scheme `tauri://localhost`,
// which YouTube's embed player rejects. There we route YouTube embeds through the
// Rust loopback shim (youtube_shim.rs): the iframe points at
// `http://127.0.0.1:<port>/yt/<token>/<id>?<flags>`, whose http origin YouTube
// accepts. In DEV (`http://localhost:1420`) and on Windows the origin already
// works, so we embed YouTube directly. Vimeo/PeerTube always embed directly (they
// play fine from `tauri://`).
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { detectVideoProvider, buildEmbedSrc } from './videoEmbed';

type EmbedEl = Parameters<typeof buildEmbedSrc>[0];

// The shim is only needed on the custom scheme (packaged macOS/Linux). Dev is
// `http:`; Windows serves `http(s)://tauri.localhost` — both accepted by YouTube.
function shimApplies(): boolean {
  try {
    return location.protocol === 'tauri:';
  } catch {
    return false;
  }
}

// Cached shim base: `null` = not fetched yet, `''` = fetched-but-unavailable/NA.
let cachedBase: string | null = null;
let inflight: Promise<string> | null = null;

function fetchShimBase(): Promise<string> {
  if (cachedBase !== null) return Promise.resolve(cachedBase);
  if (!shimApplies()) {
    cachedBase = '';
    return Promise.resolve('');
  }
  if (!inflight) {
    inflight = invoke<string>('youtube_shim_base')
      .then((b) => (cachedBase = b || ''))
      .catch(() => (cachedBase = ''));
  }
  return inflight;
}

/** Hook: the loopback shim base (`http://127.0.0.1:<port>/yt/<token>`), or `''`
 *  when the shim doesn't apply / isn't available. Resolves once, then cached. */
export function useYoutubeShimBase(): string {
  const [base, setBase] = useState<string>(cachedBase ?? '');
  useEffect(() => {
    let alive = true;
    fetchShimBase().then((b) => {
      if (alive) setBase(b);
    });
    return () => {
      alive = false;
    };
  }, []);
  return base;
}

/** Build the LIVE (editor/present) iframe src for a video embed. YouTube is routed
 *  through the loopback shim when `shimBase` is set; everything else (Vimeo,
 *  PeerTube, and YouTube in dev/Windows) uses the direct `buildEmbedSrc` URL. */
export function liveEmbedSrc(el: EmbedEl, shimBase: string): string | null {
  if (shimBase && el && el.url) {
    const parsed = detectVideoProvider(el.url);
    if (parsed && parsed.provider === 'youtube') {
      const flags = new URLSearchParams();
      // Raw element flags; the Rust shim derives showControls = controls || !autoplay,
      // mirroring buildEmbedSrc's YouTube branch.
      if (el.autoplay) flags.set('autoplay', '1');
      if (el.muted) flags.set('mute', '1');
      if (el.loop) flags.set('loop', '1');
      if (el.controls) flags.set('controls', '1');
      if (el.captions) flags.set('captions', '1');
      const q = flags.toString();
      return `${shimBase}/${parsed.id}${q ? `?${q}` : ''}`;
    }
  }
  return buildEmbedSrc(el);
}
