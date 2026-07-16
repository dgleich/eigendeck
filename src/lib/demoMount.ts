// Spike (docs/DEMO-PLATFORM.md): mount a demo in an OPAQUE-ORIGIN iframe.
//
// With sandbox="allow-scripts" (no allow-same-origin) the parent can no longer
// write the demo's contentDocument, so everything the demo needs at init must be
// spliced into the mounted bytes BEFORE load, and live traffic goes over a
// parent postMessage relay instead of a same-origin BroadcastChannel.
//
// buildDemoDocument = raw bytes
//   + injectDemoBootstrap  (BroadcastChannel->parent relay + URL-param patch — reused from the export path)
//   + injectDemoThemeIntoHtml (theme vars + data-URL @font-face, spliced into <head>)
// then blob it. Blobs are cached by a composite signature (asset + hash + theme +
// fonts) so a themed re-render reuses the blob but a theme switch rebuilds it.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { injectDemoBridge } from './demoBridge';
import { injectDemoThemeIntoHtml, demoReferencesFonts } from './demoTheme.mjs';
import { buildEmbeddedFontFacesCSS } from './fonts';
import { hashString } from './hash';
import { usePresentationStore } from '../store/presentation';
import { usePreference } from './preferences';
import { manifestHosts } from './demoManifest';

// A demo reaches the internet ONLY via a network MANIFEST that declares its hosts
// (src/lib/demoManifest.ts). No manifest → no network (it can't silently phone
// home); a manifest → scoped to exactly its declared hosts. The global master +
// per-deck switches sit on top (either forces a full block).
function demoNet(outerBlock: boolean, html: string): 'block' | { hosts: string[] } {
  if (outerBlock) return 'block';
  const hosts = manifestHosts(html);
  return hosts.length ? { hosts } : 'block';
}

/** Whether a demo should be cut off from the internet. Blocked if ANY layer says
 *  so: the global master switch is OFF, OR this deck is per-deck blocked, OR (when
 *  `assetId` is given) this specific demo is individually denied. Reactive to the
 *  pref, the open deck, and the deck-security window's live toggles. */
export function useDemoInternetBlocked(assetId?: string): boolean {
  const [allow] = usePreference('demoInternetAccess');
  const projectPath = usePresentationStore((s) => s.projectPath);
  const [blocked, setBlocked] = useState(false); // deck OR per-demo block
  useEffect(() => {
    let alive = true;
    const recheck = async (fresh: boolean) => {
      // Loading the store/ledger modules can only fail outside Tauri (tests, SSR),
      // where "not blocked" is the correct default. But once we HAVE a deck token,
      // a failure to READ the block state is unexpected in the app — fail CLOSED
      // (treat as blocked) rather than silently ignoring a viewer's block.
      let ts: typeof import('./trustStore');
      let token: string | null | undefined;
      try {
        token = (await import('../store/presentation')).getDeckToken();
        if (!token) { if (alive) setBlocked(false); return; }
        ts = await import('./trustStore');
      } catch { if (alive) setBlocked(false); return; }  // non-Tauri / test → not blocked
      try {
        if (fresh) ts.invalidateLedgerCache(); // the security window may have just changed it
        const deck = await ts.isDeckInternetBlocked(token);
        const demo = assetId ? await ts.isDeckDemoBlocked(token, assetId) : false;
        if (alive) setBlocked(deck || demo);
      } catch { if (alive) setBlocked(true); }  // read error with a real deck → fail CLOSED
    };
    void recheck(false);
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen('eigendeck:security-changed', () => { void recheck(true); }))
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { alive = false; unlisten?.(); };
  }, [projectPath, assetId]);
  return !allow || blocked;
}

// composite-key -> blob URL. Keyed so a theme/font/hash change makes a new blob.
const docBlobCache = new Map<string, string>();
// assetIds whose bytes were checked and are NOT a marked eigendeck demo.
const blockedCache = new Set<string>();
// raw demo bytes per asset (validated), so a re-theme doesn't refetch.
const rawCache = new Map<string, string>();

async function fetchRawDemo(assetId: string): Promise<string | null> {
  const cached = rawCache.get(assetId);
  if (cached != null) return cached;
  try {
    const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId });
    const bytes = new Uint8Array(data);
    const { isEigendeckDemo } = await import('./assetTypes.mjs');
    if (!isEigendeckDemo(bytes).ok) { blockedCache.add(assetId); return null; }
    const html = new TextDecoder().decode(bytes);
    rawCache.set(assetId, html);
    return html;
  } catch { return null; }
}

export interface DemoMountOpts {
  /** hash string like "piece=graph" or "role=controller" (no leading #). */
  hash?: string;
  /** channel key so a demo's controller + pieces share a relay namespace. */
  channelKey: string;
  /** :root{--eigendeck-*} block for the slide's theme. */
  varsCss?: string;
  /** data-URL @font-face block for the deck fonts. */
  fontFacesCss?: string;
  /** editor-only: inline the capture handler so the demo can rasterize itself. */
  capture?: boolean;
  /** cut this demo off from the internet (global master switch OFF or the deck's
   *  per-deck block) — injects a connect-src lockdown + WebRTC neuter (demoBridge). */
  blockInternet?: boolean;
}

/** Build (or reuse) the opaque-origin demo document blob URL. Returns null when
 *  the bytes aren't a marked demo, undefined while loading. */
export async function getDemoDocumentUrl(assetId: string | undefined, opts: DemoMountOpts): Promise<string | null> {
  if (!assetId) return null;
  if (blockedCache.has(assetId)) return null;
  const { hash = '', channelKey, varsCss = '', fontFacesCss = '', capture = false, blockInternet = false } = opts;
  // The prefix identifies ONE mount (asset+role/piece+capture+net-block); only the
  // trailing theme/font hashes vary. So a theme switch, the async fonts resolving
  // from '', OR the internet toggle flipping supersedes the prior blob for the same
  // prefix — revoke it (else it leaks, with the inlined modern-screenshot bytes when
  // capture is on). Other pieces of the same demo use a different `hash` → different
  // prefix → untouched.
  const prefix = `${assetId} ${hash} ${channelKey} ${capture ? 'C' : ''}${blockInternet ? 'B' : ''} `;
  const key = prefix + `${hashString(varsCss)} ${hashString(fontFacesCss)}`;
  const existing = docBlobCache.get(key);
  if (existing) return existing;
  for (const [k, u] of docBlobCache) {
    if (k !== key && k.startsWith(prefix)) { URL.revokeObjectURL(u); docBlobCache.delete(k); }
  }
  const raw = await fetchRawDemo(assetId);
  if (raw == null) return null;
  // Only splice the (megabyte-scale, base64) @font-face faces into demos that
  // actually name a deck font — otherwise every mount re-parses fonts the demo
  // can't use. The theme vars still go in (cheap, and a demo may use the colors).
  const effFontFaces = demoReferencesFonts(raw, fontFacesCss) ? fontFacesCss : '';
  const withBridge = injectDemoBridge(raw, hash ? `#${hash}` : '', channelKey, { capture, net: demoNet(blockInternet, raw) });
  const doc = injectDemoThemeIntoHtml(withBridge, effFontFaces, varsCss);
  const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  docBlobCache.set(key, url);
  return url;
}

// --- isolated notebook output (docs/NOTEBOOK-ISOLATION.md) --------------------
// Script-bearing notebook output (Plotly etc.) is mounted in an opaque-origin
// iframe — the same containment as a demo — instead of sanitized inline, so it
// stays interactive AND can't reach Tauri. The output is an HTML FRAGMENT, so we
// wrap it in a minimal document (natural height; the size reporter grows the host
// iframe to fit), then splice the bridge + theme like a demo. Keyed by content +
// theme; superseded theme variants for the same content are revoked.
const outputBlobCache = new Map<string, string>();

export function buildIsolatedOutputUrl(html: string, opts: {
  channelKey: string; varsCss?: string; fontFacesCss?: string; blockInternet?: boolean;
}): string {
  const { channelKey, varsCss = '', fontFacesCss = '', blockInternet = false } = opts;
  const contentSig = hashString(html);
  const key = `${contentSig} ${channelKey} ${blockInternet ? 'B' : ''} ${hashString(varsCss)} ${hashString(fontFacesCss)}`;
  const existing = outputBlobCache.get(key);
  if (existing) return existing;
  const prefix = `${contentSig} ${channelKey} `;
  for (const [k, u] of outputBlobCache) {
    if (k !== key && k.startsWith(prefix)) { URL.revokeObjectURL(u); outputBlobCache.delete(k); }
  }
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;}</style></head><body>${html}</body></html>`;
  const withBridge = injectDemoBridge(page, '', channelKey, { reportSize: true, net: demoNet(blockInternet, html) });
  const doc = injectDemoThemeIntoHtml(withBridge, fontFacesCss, varsCss);
  const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  outputBlobCache.set(key, url);
  return url;
}

/** Revoke + drop all cached blobs for an output instance (its channelKey is
 *  unique per mount). Call on IsolatedOutput unmount so blobs don't accumulate
 *  across a long presenting session. */
export function invalidateIsolatedOutput(channelKey: string): void {
  for (const [k, u] of outputBlobCache) {
    if (k.includes(` ${channelKey} `)) { URL.revokeObjectURL(u); outputBlobCache.delete(k); }
  }
}

/** React hook: the opaque-origin demo document URL, rebuilt when inputs change. */
export function useDemoDoc(assetId: string | undefined, opts: DemoMountOpts): string | null | undefined {
  const { hash, channelKey, varsCss, fontFacesCss, capture } = opts;
  const blockInternet = useDemoInternetBlocked(assetId);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  // Reload when the underlying asset bytes change on disk (file-watch / "Reload
  // from disk now" fire eigendeck:asset-changed). invalidateDemoDoc drops the
  // cached raw bytes + blobs so the refetch below rebuilds from the new content —
  // the behavior the old same-origin useDemoUrl had.
  useEffect(() => {
    if (!assetId) return;
    const onChanged = (e: Event) => {
      if ((e as CustomEvent).detail?.assetId === assetId) { invalidateDemoDoc(assetId); setRefresh((k) => k + 1); }
    };
    window.addEventListener('eigendeck:asset-changed', onChanged);
    return () => window.removeEventListener('eigendeck:asset-changed', onChanged);
  }, [assetId]);
  useEffect(() => {
    if (!assetId) { setUrl(undefined); return; }
    let alive = true;
    getDemoDocumentUrl(assetId, { hash, channelKey, varsCss, fontFacesCss, capture, blockInternet })
      .then((r) => { if (alive) setUrl(r); });
    return () => { alive = false; };
  }, [assetId, hash, channelKey, varsCss, fontFacesCss, capture, blockInternet, refresh]);
  return url;
}

// --- deck fonts as data URLs (memoized) --------------------------------------
// Opaque-origin demos can't fetch app-origin /fonts, so we splice data-URL
// @font-face into each demo doc. Memoized by the deck's used-font signature so
// the (async, base64) build runs once per font set, not per demo mount.
let fontCssCache: { key: string; css: string } | null = null;
interface FontDeck {
  config?: { defaultTitleFont?: string; defaultBodyFont?: string; defaultHypeFont?: string };
  slides?: Array<{ titleFont?: string; bodyFont?: string; hypeFont?: string }>;
}
export async function deckFontFacesCss(presentation: FontDeck): Promise<string> {
  const key = JSON.stringify({
    c: presentation.config,
    s: (presentation.slides || []).map((s) => [s.titleFont, s.bodyFont, s.hypeFont]),
  });
  if (fontCssCache && fontCssCache.key === key) return fontCssCache.css;
  const css = await buildEmbeddedFontFacesCSS(presentation);
  fontCssCache = { key, css };
  return css;
}

/** React hook: the deck's data-URL @font-face CSS (empty until built). */
export function useDeckFontFacesCss(): string {
  const config = usePresentationStore((s) => s.presentation.config);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const [css, setCss] = useState('');
  useEffect(() => {
    let alive = true;
    deckFontFacesCss({ config, slides }).then((c) => { if (alive) setCss(c); });
    return () => { alive = false; };
  }, [config, slides]);
  return css;
}

/** Drop cached blobs/bytes for an asset (after re-import / bytes change). */
export function invalidateDemoDoc(assetId: string): void {
  rawCache.delete(assetId);
  blockedCache.delete(assetId);
  for (const [k, url] of docBlobCache) {
    if (k.startsWith(`${assetId} `)) { URL.revokeObjectURL(url); docBlobCache.delete(k); }
  }
}

// --- thumbnail capture (in-demo) ---------------------------------------------
// Opaque origin blocks the parent from reaching a demo's DOM, so the parent asks
// the in-demo bridge to rasterize itself and post the PNG back (docs/DEMO-PLATFORM.md §8).
let captureSeq = 0;
export function requestDemoCapture(
  iframe: HTMLIFrameElement,
  opts: { width: number; height: number; backgroundColor?: string },
  timeoutMs = 5000,
): Promise<string | null> {
  const cw = iframe.contentWindow;
  if (!cw) return Promise.resolve(null);
  const id = `cap${++captureSeq}`;
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __eigendeck?: number; type?: string; id?: string; dataUrl?: string } | undefined;
      if (!d || d.__eigendeck !== 1 || d.type !== 'capture-result' || d.id !== id) return;
      cleanup();
      resolve(d.dataUrl || null);
    };
    const timer = window.setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const cleanup = () => { window.removeEventListener('message', onMsg); clearTimeout(timer); };
    window.addEventListener('message', onMsg);
    cw.postMessage({ __eigendeck: 1, type: 'capture', id, width: opts.width, height: opts.height, backgroundColor: opts.backgroundColor }, '*');
  });
}

// --- demo host infrastructure (shared by every window that renders demos) ----
// Both the relay and the rAF pump are per-window infra. Rather than wire them into
// each window entry (App, the presenter window, …) — which is exactly how the
// presenter kept missing demo features — any component that HOSTS demos calls
// useDemoHost(). Ref-counted so overlapping hosts share one install and it tears
// down when the last unmounts. This is the single source of truth for "a window
// is showing demos, so it needs the relay + pump".
let hostRefs = 0;
let hostCleanup: (() => void) | null = null;
export function useDemoHost(): void {
  useEffect(() => {
    hostRefs++;
    if (hostRefs === 1) {
      const relay = installDemoRelay();
      const pump = installRafPump();
      hostCleanup = () => { relay(); pump(); };
    }
    return () => {
      hostRefs--;
      if (hostRefs === 0 && hostCleanup) { hostCleanup(); hostCleanup = null; }
    };
  }, []);
}

// --- parent-side rAF pump ----------------------------------------------------
// WebKit throttles rAF to 30fps in cross-origin (opaque) demo frames until they
// see a trusted interaction (docs/DEMO-PLATFORM.md §16). The parent top document
// is NOT throttled, so run one 60fps rAF loop and post a tick to every demo frame
// each frame; the bridge fires the demo's rAF callbacks on each tick. When no
// demo is on screen the loop idles at ~10Hz (well under the bridge's 400ms native
// fallback) so a text-only slide doesn't spin the main thread at 60fps.
// Single-install is guaranteed by useDemoHost's ref-count; no self-guard needed.
function installRafPump(): () => void {
  if (typeof window === 'undefined') return () => {};
  let running = true;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const pump = (t: number) => {
    if (!running) return;
    const frames = document.querySelectorAll('iframe.el-demo-frame');
    if (frames.length === 0) { idle = setTimeout(() => requestAnimationFrame(pump), 100); return; }
    for (const f of frames) {
      const cw = (f as HTMLIFrameElement).contentWindow;
      if (cw) { try { cw.postMessage({ __eigendeck: 1, type: 'raf-tick', t }, '*'); } catch { /* opaque */ } }
    }
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
  return () => { running = false; if (idle) clearTimeout(idle); };
}

// --- parent-side relay -------------------------------------------------------
// Opaque-origin demos can't share a BroadcastChannel, so the injected bootstrap
// posts {__bc, payload} to window.parent; this relay fans each message out to
// every OTHER demo iframe (sender excluded). Receivers filter by their own
// channel name, so per-demo/per-instance keying happens on the receive side
// (same as the export relay). Single-install is guaranteed by useDemoHost.
function installDemoRelay(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { __bc?: string } | undefined;
    if (!d || !d.__bc) return;
    const frames = document.querySelectorAll('iframe.el-demo-frame');
    frames.forEach((f) => {
      const cw = (f as HTMLIFrameElement).contentWindow;
      if (cw && cw !== e.source) { try { cw.postMessage(d, '*'); } catch { /* opaque; ignore */ } }
    });
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
