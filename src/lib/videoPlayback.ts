// Shared <video> playback wiring for the editor, present, and presenter views,
// so all three honor the element's options identically.

import { useEffect, type RefObject } from 'react';
import { postEmbedSpeed } from './videoEmbed';

/** Toggle a file <video>'s play/pause. Used as the click handler when controls
 *  are off, so a chrome-free video is still startable by clicking it (otherwise
 *  there's no affordance — in present mode it would just sit on frame 0). */
export function togglePlay(v: HTMLVideoElement | null): void {
  if (!v) return;
  if (v.paused) void v.play().catch(() => {});
  else v.pause();
}

/** Apply playback speed to an EMBED via the provider's postMessage API. Posts a
 *  few times after the iframe (re)loads since there's no player-ready callback
 *  wired — best-effort. No-op at rate 1 (provider default). */
export function useEmbedSpeed(
  ref: RefObject<HTMLIFrameElement | null>, provider: string | undefined, rate: number, srcKey: unknown,
): void {
  useEffect(() => {
    if (!provider || !rate || rate === 1) return;
    const post = () => postEmbedSpeed(ref.current?.contentWindow, provider, rate);
    const timers = [600, 1500, 3000].map((ms) => setTimeout(post, ms));
    return () => timers.forEach(clearTimeout);
  }, [ref, provider, rate, srcKey]);
}

/** Keep the element's playbackRate applied (it resets on src/metadata change). */
export function usePlaybackRate(
  ref: RefObject<HTMLVideoElement | null>, rate: number, srcKey: unknown,
): void {
  useEffect(() => {
    const v = ref.current;
    if (v) v.playbackRate = rate || 1;
  }, [ref, rate, srcKey]);
}

/** Ping-pong reverse loop (file only, BEST-EFFORT). When enabled, the video
 *  plays forward, then reverse-seeks back to the start, repeating. Reverse has
 *  no native support — we step currentTime backwards via rAF, which is smooth
 *  only for short clips (depends on keyframe spacing). Disable native loop when
 *  this is on. No-op when disabled or the video isn't ready. */
export function usePingPong(
  ref: RefObject<HTMLVideoElement | null>, enabled: boolean, rate: number, srcKey: unknown,
): void {
  useEffect(() => {
    const v = ref.current;
    if (!v || !enabled) return;
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      const el = ref.current;
      if (!el) return;
      const dt = (now - last) / 1000;
      last = now;
      el.currentTime = Math.max(0, el.currentTime - dt * (rate || 1));
      if (el.currentTime <= 0.001) { void el.play().catch(() => {}); return; }  // back at start → forward
      raf = requestAnimationFrame(step);
    };
    const onEnded = () => { last = performance.now(); raf = requestAnimationFrame(step); };
    v.addEventListener('ended', onEnded);
    return () => { v.removeEventListener('ended', onEnded); cancelAnimationFrame(raf); };
  }, [ref, enabled, rate, srcKey]);
}
