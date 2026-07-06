# Eigendeck Demo Platform — design

Status: **design, agreed 2026-07-04.** Not yet implemented. Companion to
[`ASSETS-SECURITY.md`](ASSETS-SECURITY.md) (the trust/read model for assets) and to
the author-facing `src-tauri/resources/llm-tools/DEMO_SPEC.md` (which will be
brought in line with this once built). This document owns the *why* and the
*rules* for how an embedded HTML demo talks to Eigendeck, and how it stays
isolated from the app.

Each section marks what is **[v1]** (built now, to unblock the security fix) vs
**[deferred]** (designed here so the foundation accommodates it, implemented
later).

---

## 1. Purpose & context

A `.eigendeck` is an untrusted file people share. Its embedded demos are
attacker-controlled HTML that today run with `sandbox="allow-scripts
allow-same-origin"` over a same-origin `blob:` URL. The security audit
(`.claude/notes/security-audit-2026-07-01.md`, finding **C-3**) showed this is a
full sandbox escape: demo JS reaches `window.top.__TAURI_INTERNALS__.invoke`,
and with the broad `fs:*-all` grant (**H-1**) and no CSP (**C-6**) that becomes
arbitrary local file read/write and exfiltration, on merely opening or presenting
a deck.

The fix is to **drop `allow-same-origin`** so each demo runs in an opaque origin
with no line to the app. But the app *relies* on same-origin access for three
things: theme injection (writes the demo's `contentDocument`), thumbnail capture
(reads the demo's `contentDocument`), and multi-part communication (in-app demos
use a real `BroadcastChannel`, which works only because same-origin blob iframes
share the app origin). Closing the hole breaks all three.

So this is not only a security patch. It is the point at which we give demos a
real, stable communication contract. We have re-edited demos twice already (theme
inheritance, then cross-demo comm); the goal here is one extensible foundation so
we stop doing that.

## 2. Principles

1. **Demos are standard web pages that run anywhere.** A demo authored against
   this contract runs unchanged in a plain browser (with fallbacks) and inside
   Eigendeck (with real values). This is a hard requirement, and it is what
   selects the primitives below.
2. **The smarts live in an app-injected bridge, never baked into the saved
   file.** Eigendeck controls and versions the bridge, so new host capabilities
   are added to the bridge, not to every demo. The stored `.html` stays a clean,
   shareable, browser-runnable page.
3. **Static injection for anything known at mount; `postMessage` only for live
   traffic.** Values a demo reads during init (theme vars, fonts, parameters,
   inlined data) are spliced into the HTML *before scripts run*, so there is no
   delivery race. `postMessage` is reserved for genuinely live/bidirectional
   traffic (piece comm, capture, steps, live theme switch).
4. **The runtime interface is opt-in and additive.** A demo using only
   `BroadcastChannel` + CSS `var()` fallbacks keeps working. A demo opts into more
   by touching `window.eigendeck`. Unknown message types and unknown markers are
   ignored on both sides, so new features never break old demos.

## 3. Isolation model [v1]

Demos mount with **`sandbox="allow-scripts"` only** (opaque origin). Blob or
`srcdoc` delivery both give an opaque origin once `allow-same-origin` is dropped;
we keep the current blob-per-asset path and splice the bridge + provisioning into
the bytes before creating the blob.

Opaque origin **cuts** the demo off from all *local* resources:

- `window.top` / `window.parent.__TAURI_INTERNALS__` — the escape in C-3
- the parent's `contentDocument` (both directions)
- app-origin blob URLs, `localStorage`, cookies, IndexedDB
- the shared `BroadcastChannel` (origin-keyed)

Outbound network is governed by the injected CSP, NOT by `sandbox` (which has no
network token). Since the manifest gate shipped, a demo is **offline by default**:
`fetch`/XHR/WebSocket/CDN `<script>`/remote `<img>` are blocked unless the demo
**declares the host** in an `application/eigendeck-manifest+json` block, which
scopes the injected CSP to exactly those hosts. The global + per-deck + per-demo
switches sit on top. See **[`CSP-AND-EGRESS.md`](CSP-AND-EGRESS.md) §2b/§2c** for
the full model; the coarse block below is the original v1 slice.

### Block-internet control [v1]

Egress is a separate, opt-in lever (audit workstream G). Isolation stops a demo
reaching the machine, but a malicious demo can still beacon out. After isolation
there is little *local* secret left to steal, so this defaults **off**, for the
paranoid.

- **Enforcement:** when blocking is on, the injected `<head>` leads with a
  restrictive CSP `<meta>`: `connect-src 'none'; img-src 'self' data: blob:;
  media-src 'self' data: blob:; font-src 'self' data:; script-src 'unsafe-inline'
  blob:; style-src 'unsafe-inline'; frame-src 'none'`. This kills
  `fetch`/XHR/WebSocket and remote beacons while leaving inline code + blob assets
  working. A CSP meta must precede content, so toggling re-mounts the iframe (we
  already re-mount on `reloadKey`).
- **Settings, both app-side (never in the deck, so a malicious deck can't grant
  its own demos network):**
  - Global preference: *Allow demos to access the internet* (default on). This is
    the master switch.
  - Per-deck control in the Security window: a single checkbox, default off,
    *Block internet access for this deck's demos*. Stored alongside the trust
    ledger, keyed by deck.
- **The cascade is restrictive-only.** A per-deck setting can only *tighten*, it
  can never *grant* internet against a global block. So:

  > effective-allow = (global allows) AND (this deck is not blocked)

  When the global switch is **off**, every demo is blocked everywhere and the
  per-deck control cannot re-enable it. In that state the per-deck checkbox is
  shown disabled with a note pointing at the global setting, because it can only
  block and blocking is already in force. When the global switch is **on**, the
  per-deck checkbox blocks this one deck. This mirrors the trust model: local
  policy may restrict a stricter global, never loosen it.

## 4. The two-tier interface

### Tier A — always-works base (no execution needed) [v1]

Everything the host needs to *render and provision* a demo is available without
running it:

- **Theme** via CSS custom properties: the demo writes `var(--eigendeck-accent,
  #333)` etc. Fallback applies in a plain browser; Eigendeck supplies the real
  `--eigendeck-*` block at mount.
- **Fonts** via data-URL `@font-face` spliced at mount (§5, §9).
- **Multi-part comm** via `BroadcastChannel`, relayed across the opaque boundary
  by the bridge (§6), keyed per element instance.
- **Static markers** (HTML comments) the host parses without executing the demo:
  - `<!--eigendeck-demo-v1-->` — the existing mount-gate marker (see
    `ASSETS-SECURITY.md`, the demo-ingestion invariant). Required.
  - `<!--eigendeck-v1-parameter: {…}-->` — a declared, typed, constrained input
    (§7).
  - `<!--eigendeck-v1-data-->` — a replacement point for provisioned data (§7,
    §10).
  - `<!--eigendeck-v1-capability: {…}-->` — declared capabilities (steps, image
    override, pieces) so the host knows what it may drive.

Existing demos and plain-browser demos live entirely in Tier A.

### Tier B — optional `window.eigendeck` runtime [v1 core, features staged]

A demo opts into richer, live behavior via `window.eigendeck`. There is **one
interface, two implementations**:

- The **reference shim** (`eigendeck-shim.js`, shipped next to
  `demo-starter.html`) installs *only if the real bridge is absent*, backing
  everything with standalone defaults. A demo including it runs correctly in a
  plain browser.
- The **real bridge**, injected by Eigendeck at mount *before* the demo's
  scripts, sets `window.eigendeck` first, so the shim's guard yields to it
  in-app. Same method names, backed by `postMessage` to the host.

The v1 interface, expressed as the reference shim (the shim *is* the spec):

```js
// eigendeck-shim.js — reference/standalone impl. Idempotent: the real bridge
// installs first when hosted, so this only fills in for a plain browser.
(function () {
  if (window.eigendeck) return;                       // real bridge already here
  const hp = new URLSearchParams(location.hash.slice(1));
  const noop = () => {};
  window.eigendeck = {
    version: 1,
    hosted: false,                                    // true only in the real bridge
    // lifecycle
    ready: noop,                                      // "loaded"
    rendered: noop,                                   // "painted current state" → capture cue
    // declaration (also expressible as <!--eigendeck-v1-*--> markers)
    register: noop,                                   // {pieces, params, steps, capabilities}
    // parameters
    getParam: (name, fallback) => hp.get(name) ?? fallback,
    onParams: (cb) => cb(Object.fromEntries(hp)),     // fire once with URL params standalone
    reportValid: noop,                                // (name, ok, msg) → host red/green light
    // theme (standalone relies on CSS var() fallbacks; host pushes real values)
    onTheme: noop,
    // multi-part messaging
    channel: (name) => new BroadcastChannel(name),    // real BC works in a plain browser
    // state
    provideState: noop,                               // (getFn) host snapshots
    onRestore: noop,                                  // (setFn) host restores
    // steps
    onStep: noop,                                     // (cb(n)) host drives sequences
    // capture
    provideImage: noop,                               // (fn → dataURL) override screenshot
  };
})();
```

Staging within Tier B: the transport, `ready`/`rendered`, `onTheme`, and
`channel` are **[v1]**. `getParam`/`onParams`/`reportValid` (parameters),
`provideState`/`onRestore` (state), `onStep` (steps), and `provideImage`
(capture override) are wired as no-op/stub in v1 and filled in as their features
land (§7, §8).

## 5. Provisioning at mount [v1]

At mount the host builds the demo document by splicing into the raw bytes, then
creates the blob:

- A `<style>` carrying the resolved `:root{--eigendeck-*}` theme vars **and** the
  data-URL `@font-face` block. This reuses the existing
  `injectDemoThemeIntoHtml(html, fontFacesCss, varsCss)` (already shared with the
  export path); we simply pass real `fontFacesCss` in-app instead of `''`, and
  move delivery from the post-load `contentDocument` write to this pre-load
  splice. See `demoTheme.mjs`.
- The bridge `<script>` (Tier B), and the reference-shim guard is superseded
  because the bridge installs first.
- `<!--eigendeck-v1-data-->` replacement for small provisioned params/data
  (large data is §10).
- The block-internet CSP `<meta>` when the effective policy says so (§3).

Because these are present before any script runs, a demo reading
`getComputedStyle(root).getPropertyValue('--eigendeck-bg')` at init (as the
caffeine demo does) sees the real value. **Font decode remains asynchronous** —
HTML text reflows when a font lands, but a demo drawing text to canvas/WebGL on
first paint should `await document.fonts.ready`. This is documented for authors;
no delivery scheme can make decode synchronous.

Live theme switches (user changes the deck theme while a demo is mounted) re-mount
the demo in v1 (re-splice, new blob). A live `onTheme` push is **[deferred]**.

## 6. Multi-part demos & the relay

The bridge is one shared module, injected in-app and baked at export, promoted
from today's export shim (`injectDemoBootstrap` in `exportCore.mjs`). It carries
only live traffic, over a versioned, additive envelope `{__eigendeck: 1, type,
…}`; both sides ignore unknown types.

### The multi-part model [v1]

A demo can be split into independently positioned **pieces**, each an iframe, plus
a hidden **controller**. This is the existing model (see `DEMO_SPEC.md`); opaque
origin changes only the transport, not the roles.

- Roles are selected by URL hash: `#role=controller` (hidden 0×0 iframe, owns the
  logic + state), `#piece=<name>` (a visible viewport that renders one part and
  forwards interactions), or none (standalone fallback).
- One HTML file serves all roles by branching on the hash.
- Eigendeck auto-creates one `demo-piece` element per declared piece and one
  hidden controller per unique demo on the slide. Piece discovery moves from
  today's brittle source regex to the `<!--eigendeck-v1-capability:
  {"pieces":[…]}-->` declaration (§4), with the regex kept as a fallback for
  un-migrated demos.

### How pieces communicate (the relay) [v1]

Same-origin `BroadcastChannel` cannot work once each piece is its own opaque
origin, so the bridge provides a drop-in replacement with an identical
author-facing API:

- The bridge overrides `BroadcastChannel`. Calling `postMessage` on a channel
  sends `{__eigendeck:1, type:'bc', key, payload}` to `window.parent`.
- The parent is a **dumb star relay**: on a `bc` message it fans the payload out
  to every *other* frame carrying the same `key` (sender excluded) — the pieces
  and controller of that one demo instance. It never delivers to the app, to
  other demos, or to demos in other windows.
- Topology is a **star through the parent, not a mesh**. Delivery is
  "everyone-but-me," reproducing BroadcastChannel semantics.

Two behaviors make it robust across mount/unmount:

- **Per-instance keying.** `key` is the demo's element/sync identity, so two
  copies of the same demo on a slide (or the same synced demo across slides) do
  not cross-talk. This fixes today's cross-instance bleed, where same-origin
  BroadcastChannel names collided.
- **Retained last state.** The relay caches the last message of a declared
  `state` type per key and replays it to a piece that mounts later (present mode,
  thumbnail capture, slide navigation). This replaces the `request-state` retry
  loop; a late viewport is current immediately.

### Relay limitations (author-facing) [v1]

- **Structured-clone only.** Payloads cross `postMessage`, so no functions, DOM
  nodes, or class instances (they arrive as plain objects). Keep messages to
  plain JSON-like data.
- **Two hops per message** (piece → parent → sibling). Fine for event-driven
  traffic (clicks, drags, state broadcasts). **Not** for per-frame streaming: do
  not relay at ~60 fps. The controller broadcasts *state changes*; each viewport
  runs its own `requestAnimationFrame` locally. (Only `harper_electron` streams
  cross-frame today and should move to this pattern.)
- **Bulk binary is copied, not moved.** A Transferable cannot be transferred to N
  targets, so large `ArrayBuffer`s fan out as copies. Push big data once at mount
  (§10), not repeatedly over the relay.
- **Same-instance scope.** A message reaches only frames of the same demo instance
  (same `key`). There is no cross-demo or cross-slide channel; that is intentional
  isolation.
- **Ordering** is preserved per sender; interleaving across senders is not
  guaranteed.

### Lifecycle & other live traffic

- `ready`/`rendered` let the host act at the right moment instead of the blind
  900 ms `setTimeout` and the export `request-state` retries. **[v1]**
- **[deferred]** messages layered on later with no demo changes: parameter
  delivery + `reportValid` (§7), state get/set (§8), `goto-step` (§8), image
  request/response (§8), live `onTheme` (§5).

## 7. Parameters & validation [deferred]

Parameters are **declared statically** so the host can inspect and validate
**without executing** the demo (safer, and the inspector works before/without
mounting):

```html
<!--eigendeck-v1-parameter: {"name":"smiles","type":"string","maxLength":80,"default":"CCO"}-->
```

- The host parses the markers to build an **inspector panel** with the right
  widget per type (slider for `number` + range, text field, enum dropdown, data
  picker), persists values per element, and shows **red/green** lights by
  validating against the declared type/constraints.
- Values are provisioned at mount (marker replacement / `getParam`), read at
  runtime via `getParam`/`onParams`.
- For validation the schema can't express (e.g. "is this a valid SMILES/PDB"),
  the demo calls `reportValid(name, ok, message)` and the host paints the light +
  reason. This is the one validation case that needs the runtime interface.

The schema travels with the file, so parameters are visible and editable
standalone too (URL params).

## 8. Screenshots & capture

Thumbnails are needed only in the live app (sidebar + link/linked-object
pickers); HTML export embeds live iframes, so it needs none. Capture always runs
while the demo is on-screen in the editor.

- **[v1] In-demo capture.** The bridge runs `modern-screenshot` (already a
  dependency, ~11 KB gz) inside the demo on request and `postMessage`s the PNG
  out; the parent stores it in `asset_cache` exactly as today. Injected into
  **editor mounts only**. Same debounce, same `backgroundColor` handling, so the
  clean-PNG behavior is unchanged. 2D-canvas and SVG/DOM demos (all current ones)
  capture correctly; a WebGL demo that sets `preserveDrawingBuffer` (as the
  caffeine demo does) also captures.
- **[deferred] `provideImage` override.** A WebGL demo that does not preserve its
  buffer declares the override and returns its own `canvas.toDataURL`.
- **[deferred] Step-sequence static capture.** For steppable demos (§ declared
  capability), a "screenshot sequence" action next to *lock* (plus a shortcut)
  steps the demo `0..N-1` via `goto-step`, screenshots each frame, and bakes them
  as static images so PDF/print show the sequence.

## 9. Fonts [v1 baseline; shared-cache deferred]

The current in-app path injects `@font-face` by **shared app-origin URL** so the
browser fetches each font once and reuses it across all demo iframes and the main
document (see `demoThemeInject.ts`). Opaque origin breaks that: an opaque demo
cannot fetch app-origin fonts (cross-origin, no CORS).

- **[v1] Baseline:** deliver fonts as **data-URL `@font-face`** (origin-
  independent bytes), spliced at mount (§5), **scoped to the slide's actual
  body/narrow/mono families** rather than all ten, to bound payload. This matches
  the export *format* (export already uses data-URL fonts) while fixing the
  *delivery* (splice, not `contentDocument`). The cost it keeps is per-document
  font decode, since opaque origins share no cache.
- **[deferred] Shared caching**, only if per-document font memory proves to hurt:
  either (a) serve `/fonts/*` with `Access-Control-Allow-Origin: *` and rely on
  WebKit's top-level-partitioned cache being shared across demo iframes (needs a
  spike on the e2e WebKit rig to confirm), or (b) a dedicated demo origin (§10),
  which shares font caching by URL and pays for large data at the same time.

Caffeine demo grounding: it uses `var(--eigendeck-font,'PT Sans')` (fallback) and
reads `--eigendeck-bg` in JS, so it needs the vars present at init (§5) and PT
Sans available (this section).

## 10. Large data [deferred]

Today's heavy demos self-inline their data (the caffeine demo bakes a 513 KB
3Dmol bundle + the A2A structure into the file), so they need no transport and
run standalone. Transport is only for the *generic* case where Eigendeck supplies
data (e.g. a PDB viewer where the user picks a structure), up to tens of MB.

Two routes when we build it:

- **Transferable ArrayBuffer + in-demo blob URL** — the parent `postMessage`s
  bytes as a zero-copy Transferable; the bridge mints a `blob:` URL inside the
  demo's own opaque origin, which the demo fetches. No base64 bloat, no
  cross-origin fetch. Keeps the opaque-origin model.
- **Dedicated demo origin (custom protocol)** — demos served from an isolated
  origin fetch data (and fonts) by URL, cached and deduped by WebKit across all
  demos. Bigger Rust change (a handler carefully scoped to serve only approved
  demo assets by id, not arbitrary paths, and with no Tauri access). Cross-origin
  isolation from the app still holds by SOP. This is the option that pays for
  fonts and large data together.

## 11. Export & standalone parity

- **Export** to a single HTML deck keeps embedding live demo iframes and inlines
  fonts + any data as data URLs (self-contained artifact). It uses the same
  bridge and the same theme/font CSS module, so in-app and export cannot drift.
- **Standalone** (open the `.html` in a browser): the reference shim installs, CSS
  `var()` fallbacks apply, `BroadcastChannel` is native, URL params work. A little
  extra author work (fallbacks) buys full portability, which also makes demos easy
  to share and test.

## 12. Security invariants

- The demo-mount marker gate (`<!--eigendeck-demo-v1-->`, re-checked on the bytes
  before creating the iframe URL) stays; see `ASSETS-SECURITY.md`.
- Demos run opaque-origin with no Tauri reach (§3). This is the primary fix.
- Static markers are **parsed, never executed**, so the inspector and validation
  never run untrusted demo code.
- A custom-protocol handler, if adopted (§10), must serve only approved demo
  assets by id with no path traversal and no Tauri access.
- CSP + fs least-privilege for the *app* webview are tracked separately in the
  Phase 2 security work; this document covers the demo boundary specifically.

## 13. Migration & compatibility

- The 12 existing `BroadcastChannel` demos and the 13 hash-param demos run
  unchanged: the relay + URL-param patch already exist in the export shim and are
  promoted in-app.
- `DEMO_SPEC.md` / `DEMO_AUTHORING.md` / `demo-starter.html` are updated to
  document `window.eigendeck` + markers, and to ship `eigendeck-shim.js`.
- The caffeine demo (WebGL, inlined data, theme vars, hash params,
  BroadcastChannel, mount marker) is the conformance example to test against.

## 14. Implementation phases

- **v1 (unblocks the security fix):** drop `allow-same-origin`; splice theme vars
  + scoped data-URL fonts at mount; promote the bridge in-app with the
  per-instance BroadcastChannel relay + `ready`/`rendered`; in-demo screenshot;
  block-internet toggle (global + per-deck). Ship `eigendeck-shim.js` and the
  no-op Tier B stubs. Verify against the caffeine demo and the e2e demo rig.
- **Deferred, additive:** typed parameters + inspector + red/green validation;
  state get/set (reopen restore, present state, late-joiner sync); step sequences
  + static-capture button; `provideImage` override; live `onTheme`; large-data
  transport; font shared-cache (spike CORS, else custom protocol).

## 15. Open decisions

1. **Font shared-cache:** accept per-document decode (v1), or spike CORS + shared
   cache, or commit to a custom-protocol origin. Coupled to large-data.
2. **Custom protocol vs opaque origin** for the large-data future: opaque +
   Transferable keeps it simple; a custom origin pays for fonts and data together
   at the cost of a scoped Rust handler and demos sharing an origin.
3. **Live theme:** re-mount (v1) vs an `onTheme` push that avoids losing demo
   state on a theme switch.

---

## 16. Known limitation: cross-origin rAF throttle (30 fps until interaction)

The opaque-origin isolation (§3) has a measured cost: **WebKit throttles
`requestAnimationFrame` to 30 fps in cross-origin iframes that have not been
interacted with**. Animated demos (canvas / WebGL / d3, anything rAF-driven)
drop from ~60 fps (the old same-origin blob) to ~30 fps under opaque origin.
Confirmed on the e2e rig: a plain visible demo runs ~64 fps on `main`
(same-origin) vs ~30 fps on the opaque branch. Regression test:
`e2e/relay-fps-probe.mjs` + `e2e/fixtures/fps-probe.html`.

**Mechanism (WebCore, both ports).** `Document::requestAnimationFrame()` adds
`ThrottlingReason::NonInteractedCrossOriginFrame` when
`!topOrigin().isSameOriginDomain(securityOrigin()) && !hasHadUserInteraction()`.
It is:

- **origin-based, not visibility-based** — a fully visible cross-origin frame is
  throttled (independent of the `OutsideViewport`/`VisuallyIdle` reasons);
- **cross-ORIGIN, not cross-site** — different scheme/host/port qualifies, and a
  `sandbox="allow-scripts"` opaque origin can never be same-origin-domain with
  the app, so it is always throttled;
- **unconditional** — there is **no `Settings`/preference, no WKPreferences key
  (public or private), no `WebKitSettings` property, no `WEBKIT_*` env var, and
  no feature flag** that disables it, on **either** WKWebView (macOS) or
  WebKitGTK (Linux). It is shared WebCore with no port `#ifdef`, so macOS behaves
  the same as the Linux rig.
- **not a compositing/headless artifact** — it is a JS-callback scheduling
  decision upstream of the compositor; `WEBKIT_DISABLE_COMPOSITING_MODE` is
  unrelated.

**Cleared by a real user interaction** inside the frame. The reason is removed in
`Document::updateLastHandledUserGestureTimestamp()` on a **trusted** gesture
(`isTrusted=true`); it then propagates **child → ancestor** up the frame tree.
Consequences:

- A synthetic/dispatched event (`el.click()`, dispatched `MouseEvent`) does **not**
  clear it — it must be a genuine OS input event.
- Interaction must land **inside the cross-origin frame (or a descendant)**;
  interacting with the app chrome only does not reach down into the demo.
- **click/tap** clears it; a pure drag/swipe may not (WebKit bug 213344).
- Once cleared it is **permanent for that document** (until navigation).

**Implications for Eigendeck.**

- Post-interaction, demos run at 60 fps. In present mode, the moment the
  presenter clicks/taps a demo it un-throttles for the rest of the slide.
- **Ambient (pre-interaction) animation is 30 fps** — e.g. a d3 force layout
  auto-settling on slide entry, before anyone clicks. This is the jank we see.
- In the **editor**, the demo's transparent drag-overlay intercepts pointer
  events until double-click, so an un-double-clicked demo never receives a
  trusted gesture and stays at 30 fps. (Present mode delivers events to the demo
  once interacting.)

**Resolution — parent-driven rAF (implemented).** The throttle is on rAF
*callback scheduling*, not paint, and the **top document is never throttled**. So
the parent runs one un-throttled 60 fps `requestAnimationFrame` loop
(`installRafPump` in `demoMount.ts`) and posts `{type:'raf-tick', t}` to every
demo frame each frame; the bridge **overrides the demo's `requestAnimationFrame`**
to fire its callbacks on each tick (`demoBridge.ts`). Demos keep calling `rAF`
normally and are clocked at the parent's full rate — **zero demo changes, opaque
origin (and the security fix) fully intact**. Measured: a solo demo 30 → 60+ fps,
a multi-part controller 30 → 63 fps with the viewport receiving ~62/sec. The
override falls back to native rAF if no tick arrives within 400 ms (a demo opened
in a plain browser, or the export artifact, which has no parent pump). This
supersedes the manual levers below.

**Manual mitigations (moot now that parent-driven rAF is in; kept for context).**

- Accept 30 fps for un-interacted ambient animation; full rate after interaction.
- Author demos so the *rAF-driven* animation isn't the throttled cross-origin
  document — e.g. drive the animation from the top document, or design demos to
  reach a static state quickly and animate on interaction.
- Keep a demo same-origin-domain with the app (the pre-fix posture) — rejected,
  it is exactly the C-3 escape we closed.
- (Deferred, unproven) a dedicated demo origin does **not** help: it is still
  cross-origin to the app, so the same throttle applies.

**Sources.** WebKit bug [170534](https://bugs.webkit.org/show_bug.cgi?id=170534)
and changeset [r215070](https://trac.webkit.org/changeset/215070/webkit) (the
feature); bug [213344](https://bugs.webkit.org/show_bug.cgi?id=213344)
(drag/touch doesn't clear); WebCore
[`Document.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp)
(`requestAnimationFrame` / `updateLastHandledUserGestureTimestamp`),
[`UserGestureIndicator.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/UserGestureIndicator.cpp),
[`AnimationFrameRate.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/AnimationFrameRate.h);
[`WKPreferencesPrivate.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h)
(no disable key). Corroboration:
[Motion Magazine](https://motion.dev/magazine/when-browsers-throttle-requestanimationframe),
[Popmotion](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/).
