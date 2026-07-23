// The shared demo bridge (docs/DEMO-PLATFORM.md §6). Injected into a demo
// document at mount so an OPAQUE-ORIGIN iframe behaves like a normal one:
//   - patches URLSearchParams so demos reading location.hash still get their
//     role/piece params (srcdoc/opaque contexts can lose location.hash)
//   - replaces BroadcastChannel with a parent-relayed postMessage channel,
//     namespaced per instance via channelKey, so a demo's pieces + controller
//     talk to each other but not across instances
//
// This is the in-app twin of the export path's injectDemoBootstrap; they will be
// unified on this module when the platform work hardens. Kept as a pure string
// builder (no DOM/React) so it can be shared and tested.

// modern-screenshot UMD, inlined so the OPAQUE-ORIGIN demo can rasterize ITSELF
// (the parent can't reach contentDocument). Only spliced when capture is on
// (editor mounts) — docs/DEMO-PLATFORM.md §8. The UMD sets window.modernScreenshot.
import MS_UMD_RAW from 'modern-screenshot/dist/index.js?raw';
import { hostsToCspSources } from './demoManifest';

// modern-screenshot minimizes serialized styles by diffing against defaults
// computed in a NESTED sandbox iframe (`getSandBox` -> `contentWindow.document`).
// Inside our opaque-sandboxed demo that nested iframe is also opaque, so that
// access throws "Blocked a frame ... cross-origin". Neuter the sandbox lookup so
// getDefaultStyle takes its graceful empty-Map path (no minimization, still
// correct). See docs/DEMO-PLATFORM.md §8 and issue #117.
//
// The match is a MINIFIED token, so modern-screenshot is PINNED (exact 4.7.0 in
// package.json). The guard below turns a token mismatch into a loud build/import
// error instead of a silent capture regression — a deliberate version bump must
// re-derive the token from dist/index.js.
const MS_SANDBOX_TOKEN = 'u=c==null?void 0:c.contentWindow';
const MS_UMD = MS_UMD_RAW.replace(MS_SANDBOX_TOKEN, 'u=void 0');
if (MS_UMD === MS_UMD_RAW) {
  throw new Error(
    'demoBridge: modern-screenshot sandbox patch did not apply. The pinned build ' +
    '(package.json: modern-screenshot 4.7.0) changed its minified output. Re-derive ' +
    'MS_SANDBOX_TOKEN from node_modules/modern-screenshot/dist/index.js — see issue #117.',
  );
}

// Capture handler: on a {type:'capture'} request, rasterize document.body and
// post the PNG data URL back. Runs modern-screenshot on the MAIN thread (no
// worker option) so Tauri's blocked blob-Worker never comes into play.
const CAPTURE_HANDLER = `<script>
(function(){
  window.addEventListener('message', function(e){
    var d=e.data;
    if(!d||d.__eigendeck!==1||d.type!=='capture') return;
    var ms=window.modernScreenshot;
    function send(m){ try{ window.parent.postMessage(m,'*'); }catch(_){} }
    if(!ms||!ms.domToDataUrl){ send({__eigendeck:1,type:'capture-result',id:d.id,error:'no-modern-screenshot'}); return; }
    ms.domToDataUrl(document.body||document.documentElement, {width:d.width,height:d.height,scale:1,backgroundColor:d.backgroundColor})
      .then(function(u){ send({__eigendeck:1,type:'capture-result',id:d.id,dataUrl:u}); })
      .catch(function(err){ send({__eigendeck:1,type:'capture-result',id:d.id,error:String(err)}); });
  });
})();
</script>`;

export interface DemoBridgeOpts {
  /** editor-only: inline modern-screenshot + a capture handler for thumbnails. */
  capture?: boolean;
  /** notebook output: report content height to the parent so the host iframe
   *  grows to fit (a demo owns a fixed box; an output does not). */
  reportSize?: boolean;
  /** network policy for this demo. 'block' = no internet at all (default-src 'none';
   *  only the demo's own inline scripts/styles + data:/blob: assets render). { hosts }
   *  = internet SCOPED to those declared hosts (the manifest allowlist) for scripts,
   *  styles, fetch, images, media, fonts; anything else is blocked. Either way the
   *  demo still renders from its own content, and WebRTC is neutered (CSP blind spot).
   *  Omitted → treated as 'block' (fail closed): a demo is never mounted un-gated. */
  net?: 'block' | { hosts: string[] };
}

// Injected FIRST in <head>. The CSP <meta> must precede any resource load to be
// honored. It sets `default-src 'none'` and re-opens ONLY what a demo needs to
// render: its own INLINE scripts/styles ('unsafe-inline'), data:/blob: assets, and
// blob: frames/workers — plus the demo's DECLARED hosts (scoped connect, and the
// same hosts opened for script/style/img/media/font so a declared CDN works). A
// "block" demo declares no hosts, so every REMOTE resource — scripts, styles,
// fetches, images, media, fonts, frames — is refused: no internet means no internet.
// Inline scripts still run, so the demo renders from its own content. WebRTC bypasses
// CSP, so delete its constructors before any demo code runs (robust: the demo is
// opaque-origin, so it can't steal a fresh copy from a nested frame).
function netBlockMeta(net: 'block' | { hosts: string[] }): string {
  const hostSrc = net === 'block' ? '' : hostsToCspSources(net.hosts);
  const s = hostSrc ? ` ${hostSrc}` : '';        // declared hosts appended to a directive
  const connect = hostSrc || "'none'";
  const form = hostSrc || "'none'";
  const csp = [
    "default-src 'none'",
    // 'wasm-unsafe-eval' permits WebAssembly compilation ONLY (NOT JS eval/new
    // Function — that's the separate, dangerous 'unsafe-eval'). Without it, script-src
    // being set blocks WebAssembly.instantiate, so no Pyodide/GeoGebra/Emscripten
    // (Rust/Go/C→wasm) demo can run — including in exported decks. Demos are already
    // opaque-origin sandboxed + connect-src-gated, so wasm can't escape any further
    // than the JS we already allow. See docs/CSP-AND-EGRESS.md.
    `script-src 'unsafe-inline' 'wasm-unsafe-eval'${s}`,
    `style-src 'unsafe-inline'${s}`,
    `img-src data: blob:${s}`,
    `media-src data: blob:${s}`,
    `font-src data:${s}`,
    `connect-src ${connect}`,
    'frame-src blob: data:',
    'child-src blob:',
    'worker-src blob:',
    `form-action ${form}`,
    "base-uri 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<script>try{delete window.RTCPeerConnection;delete window.webkitRTCPeerConnection;delete window.RTCDataChannel;delete window.WebTransport;}catch(e){}</script>`;
}

// Post the document's content height to the parent whenever it changes, so the
// host can size the (opaque) iframe to its content. See docs/NOTEBOOK-ISOLATION.md §5.
const SIZE_REPORTER = `<script>
(function(){
  function send(){ try{ var el=document.documentElement;
    window.parent.postMessage({__eigendeck:1,type:'iso-size',h:Math.ceil(Math.max(el.scrollHeight, (document.body?document.body.scrollHeight:0)))}, '*'); }catch(_){} }
  if (window.ResizeObserver){ try{ new ResizeObserver(send).observe(document.documentElement); }catch(_){} }
  window.addEventListener('load', send);
  [50,300,1000].forEach(function(ms){ setTimeout(send, ms); });
})();
</script>`;

/** Splice the bridge <script> into a demo HTML string. `hash` is like
 *  "#piece=graph" (or ""), `channelKey` namespaces the relay per demo instance. */
export function injectDemoBridge(html: string, hash: string, channelKey: string, opts: DemoBridgeOpts = {}): string {
  const hashParams: Record<string, string> = {};
  if (hash) {
    const qs = hash.startsWith('#') ? hash.slice(1) : hash;
    for (const part of qs.split('&')) {
      const [k, v] = part.split('=');
      if (k) hashParams[k] = v || '';
    }
  }
  const bootstrap = `<script>
(function(){
  var __ch = ${JSON.stringify(channelKey)};
  var __hp = ${JSON.stringify(hashParams)};
  // Forward demo errors to the parent (opaque origin hides the demo console).
  function __report(msg, src){ try{ window.parent.postMessage({__eigendeck:1,type:'demo-error',message:String(msg),src:src}, '*'); }catch(_){} }
  window.addEventListener('error', function(e){ __report(e.message || e.error, 'error'); });
  window.addEventListener('unhandledrejection', function(e){ __report(e.reason, 'rejection'); });
  // Forward slide-navigation keys to the parent (#155): a focused demo otherwise
  // swallows Space/arrows in present mode so the deck can't advance. Bubble phase
  // + !defaultPrevented + not-a-form-field means a genuinely interactive demo (a
  // stepper that uses arrows) keeps them by calling preventDefault; the parent
  // only acts on this in present mode (the editor ignores it).
  var __NAVK = {' ':1,'ArrowLeft':1,'ArrowRight':1,'ArrowUp':1,'ArrowDown':1,'PageUp':1,'PageDown':1,'Home':1,'End':1};
  window.addEventListener('keydown', function(e){
    if(!__NAVK[e.key] || e.defaultPrevented) return;
    var t=e.target;
    if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
    try{ window.parent.postMessage({__eigendeck:1,type:'nav-key',key:e.key}, '*'); }catch(_){}
  }, false);
  var _ce=console.error, _cw=console.warn;
  console.error=function(){ __report([].slice.call(arguments).map(String).join(' '), 'console.error'); return _ce.apply(console,arguments); };
  console.warn=function(){ __report([].slice.call(arguments).map(String).join(' '), 'console.warn'); return _cw.apply(console,arguments); };
  try { window.location.hash = ${JSON.stringify(hash || '')}; } catch(e) {}
  var _USP = window.URLSearchParams;
  window.URLSearchParams = function(init) {
    var inst = new _USP(init);
    if (!init || init === '' || init === '#') { for (var k in __hp) inst.set(k, __hp[k]); }
    return inst;
  };
  window.URLSearchParams.prototype = _USP.prototype;
  // Opaque origins can't share a BroadcastChannel; relay via the parent.
  window.BroadcastChannel = function(name) {
    this._name = __ch + ':' + name;
    this.onmessage = null;
    var self = this;
    window.addEventListener('message', function(e) {
      if (!e.data || !self.onmessage) return;
      if (e.data.__bc === self._name) { self.onmessage({ data: e.data.payload }); }
      if (e.data.type === 'request-state' && !e.data.__bc) { self.onmessage({ data: e.data }); }
    });
  };
  window.BroadcastChannel.prototype.postMessage = function(msg) {
    try { window.parent.postMessage({ __bc: this._name, payload: msg }, '*'); } catch(e) {}
  };
  window.BroadcastChannel.prototype.close = function() { this.onmessage = null; };

  // Drive requestAnimationFrame from the parent's UN-throttled 60fps loop. WebKit
  // throttles rAF in cross-origin (opaque) frames to 30fps until interaction; the
  // parent top document isn't throttled, so it pumps ticks and we fire the demo's
  // rAF callbacks on each. Falls back to native rAF if no tick arrives (e.g. no
  // parent pump, as in a plain browser). See docs/DEMO-PLATFORM.md §16.
  var __nativeRaf = window.requestAnimationFrame.bind(window);
  var __nativeCancel = window.cancelAnimationFrame.bind(window);
  var __rafMap = Object.create(null), __rafNextId = 1, __seenTick = false, __native = false;
  // Fire callbacks queued for this frame. Delete-before-call so cancelAnimationFrame
  // during a flush (deletes from the map) is honored, and re-scheduled ids (added
  // during the flush) fire on the NEXT tick, matching native rAF semantics.
  function __flush(t){ var ids = Object.keys(__rafMap); for (var i = 0; i < ids.length; i++){ var id = ids[i], cb = __rafMap[id]; if (cb){ delete __rafMap[id]; try { cb(t); } catch(e){} } } }
  function __pumpMode(){ __native = false;
    window.requestAnimationFrame = function(cb){ var id = __rafNextId++; __rafMap[id] = cb; return id; };
    window.cancelAnimationFrame = function(id){ delete __rafMap[id]; }; }
  function __nativeMode(){ __native = true; var due = __rafMap; __rafMap = Object.create(null);
    window.requestAnimationFrame = __nativeRaf; window.cancelAnimationFrame = __nativeCancel;
    for (var id in due) __nativeRaf(due[id]); }
  __pumpMode();
  window.addEventListener('message', function(e){
    if (e.data && e.data.__eigendeck === 1 && e.data.type === 'raf-tick'){
      __seenTick = true;
      if (__native) __pumpMode();   // a slow/returning pump re-takes the clock (re-armable)
      __flush(e.data.t);
    }
  });
  // If no parent tick arrives within a generous margin, assume there's no pump
  // (plain browser / export) and use native rAF. Re-armable above if a tick shows up.
  setTimeout(function(){ if (!__seenTick) __nativeMode(); }, 1500);
})();
</script>`;
  let scripts = opts.capture ? bootstrap + `<script>${MS_UMD}</script>` + CAPTURE_HANDLER : bootstrap;
  if (opts.reportSize) scripts += SIZE_REPORTER;
  // The network policy (CSP meta + WebRTC neuter) must be FIRST in <head>. Default
  // to 'block' (fail CLOSED): a demo built without an explicit net policy gets the
  // offline lockdown, never an un-gated document — so a future caller that forgets
  // to pass `net` can't accidentally mount a demo with no CSP at all.
  scripts = netBlockMeta(opts.net ?? 'block') + scripts;
  if (html.includes('<head>')) return html.replace('<head>', '<head>' + scripts);
  return scripts + html;
}
