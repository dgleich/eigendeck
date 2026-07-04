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

/** Splice the bridge <script> into a demo HTML string. `hash` is like
 *  "#piece=graph" (or ""), `channelKey` namespaces the relay per demo instance. */
export function injectDemoBridge(html: string, hash: string, channelKey: string): string {
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
  if (html.includes('<head>')) return html.replace('<head>', '<head>' + bootstrap);
  return bootstrap + html;
}
