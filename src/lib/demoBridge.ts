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

// modern-screenshot minimizes serialized styles by diffing against defaults
// computed in a NESTED sandbox iframe (`getSandBox` -> `contentWindow.document`).
// Inside our opaque-sandboxed demo that nested iframe is also opaque, so that
// access throws "Blocked a frame ... cross-origin". Neuter the sandbox lookup so
// getDefaultStyle takes its graceful empty-Map path (no minimization, still
// correct). Version-specific token — if a modern-screenshot bump breaks capture,
// re-derive it from dist/index.js. See docs/DEMO-PLATFORM.md §8.
const MS_UMD = MS_UMD_RAW.replace('u=c==null?void 0:c.contentWindow', 'u=void 0');

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
}

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
})();
</script>`;
  const scripts = opts.capture ? bootstrap + `<script>${MS_UMD}</script>` + CAPTURE_HANDLER : bootstrap;
  if (html.includes('<head>')) return html.replace('<head>', '<head>' + scripts);
  return scripts + html;
}
