# Eigendeck CSP & Demo Network Egress — design + status

Status: **[v1] internet block implemented 2026-07-06.** Companion to
[`DEMO-PLATFORM.md`](DEMO-PLATFORM.md) (opaque-origin demo isolation) and
[`NOTEBOOK-ISOLATION.md`](NOTEBOOK-ISOLATION.md). Covers audit finding **C-6 / H-6**
(`csp: null`) and the control over where embedded demos may talk on the network.

This doc was revised after we built and *tested* the first slice — several of the
originally-planned pieces turned out to be blocked by a WebKit reality (§4) and are
deferred behind a bigger change (#122). What shipped is the one control the security
+ end-user reviews both endorsed; the finer-grained machinery waits.

---

## 1. Philosophy — default is PERMISSIVE

The CSP here is a **backstop, not a cage.** By the time it lands the real surface is
already closed: demos run opaque-origin sandboxed (no app/Tauri/file access, C-3);
injection sinks are sanitized/contained (C-1/2/4/5); the webview has no `fs`
capability (all I/O in gated Rust). A contained demo reaching the network is
**low-risk** — it can't read your files or app state, only fetch. So blocking the
internet by default would break legitimate demos (a CDN chart, a live-data widget)
to defend an already-contained threat. **Default: demos may use the internet.** The
control is opt-in, for the cautious / offline / a half-trusted deck.

## 2. What shipped — the internet block  **[v1, done]**

One coarse, all-or-nothing switch (two toggles that combine), default ON:

- **Global master switch** — Settings → Security → "Let demos use the internet"
  (pref `demoInternetAccess`, default true). OFF trumps everything.
- **Per-deck** — deck Security window → Internet tab → "Block internet access for
  this deck's demos." Stored in the trust ledger (`blockInternet` on the deck
  entry), so it's the *viewer's* local choice, works even on an untrusted deck, and
  doesn't modify the file.

**Enforcement** (`src/lib/demoBridge.ts`): when `useDemoInternetBlocked()` is true
(master OFF **or** deck blocked), the demo document is built with, injected FIRST in
`<head>`:
- a CSP `<meta>`: `connect-src 'none'; img-src data: blob:; media-src data: blob:;
  font-src data:; form-action 'none'; frame-src blob: data:` — closes every egress
  channel (fetch/XHR/WS/beacon/pixel/media/font/form) while leaving `script-src`/
  `style-src` unset, so the demo still runs and renders from its own inline/data:/
  blob: content;
- a **WebRTC neuter** (`delete window.RTCPeerConnection` + `webkitRTCPeerConnection`
  + `RTCDataChannel`) — closes the one egress channel CSP doesn't govern (§8).

Verified in real WebKit (e2e `netblock-probe`, `NETBLOCK_PASS`): with internet off,
a demo mounts with `RTCPeerConnection` gone AND a `fetch` tripping a `connect-src`
violation, while its inline script still runs.

## 3. The mechanism it rests on: CSP inheritance

A `blob:` document **inherits the embedding page's CSP** and can only make it *more*
restrictive, never looser (CSP3 inherit; WebKit honors it). This is what lets us
tighten one demo's egress by injecting a `<meta>` into its doc — the demo can't undo
it. It's also why the *global* master switch is a robust wall.

## 4. Why there is NO app-wide `script-src` CSP (the C-6 backstop)

We wanted `script-src 'self'` on the app frame — an injected `<script>` in the
privileged frame couldn't run. Everything Eigendeck loads is local (bundled MathJax
-nosre, fonts, no CDN in the parent), so it *seemed* free. **We tested it, and it
breaks demos** — decisively:

- A strict parent `script-src 'self'` is **inherited by the blob-iframe demos** (§3),
  which run **inline** scripts (the bridge + the demo's own code) and often load
  libraries from a **CDN** (`<script src="https://cdn…">`). Both are blocked. Rig
  test: the demo's inline script didn't run (`NBSEC_FAIL`); adding `'unsafe-inline'`
  fixed inline but CDN `<script src>` stays blocked (that's the whole point of
  `script-src 'self'` — you can't have it *and* CDN demos).
- MathJax is fine either way — it computes in its own same-origin iframe (not
  governed by the parent CSP), so no `'unsafe-eval'` is needed.

So a real script backstop for the parent **requires demos to NOT inherit the parent
CSP** — i.e. serving demos from a **custom Tauri protocol** instead of `blob:`
(tracked in **#122**, deferred to post-v1). Until then, shipping `script-src 'self'`
would break demos and shipping `'self' 'unsafe-inline' https:` buys almost nothing.
So v1 ships **no app-wide CSP**; the backstop waits for #122.

## 5. Deferred — finer-grained egress control

We'd like to do more than a single on/off. It all needs **finer control** than a
boolean (per-host, per-purpose), which is meaningfully more machinery — and the most
valuable piece (a strict parent) is gated on #122. Deferred:

- **Per-deck egress modes** — Open / Local-only / **Allowlist** (allow `localhost` +
  specific hosts, block the rest). The allowlist is just a different injected CSP
  (`default-src 'self' <hosts>`), but it needs a host-list UI + storage.
- **Per-demo network manifest + approval** — a demo *declares* the hosts + purpose it
  needs; the user approves a subset; only approved hosts enter the injected
  allowlist. Core rule: **declared ≠ granted** (the manifest is consent/transparency;
  the CSP is the wall). Keep the manifest in the file format for authoring, out of
  the everyday UI.
- **Violation reporting** — surface when a demo tries to reach an undeclared/
  unapproved host (`report-to`) as tamper-evidence. (We already lean on
  `securitypolicyviolation` in the e2e; not a user feature yet.)

These are the "allow stock-data but not trackers, per demo" future. Not needed for
v1; the coarse block covers the real user need ("keep this deck offline").

## 6. Directive → exfil-channel map (reference for the allowlist future)

Locking `default-src` to the allowlist covers most as the fallback; set `form-action`
explicitly. WebRTC is not CSP-governed → the bridge neuter (§2/§8).

| Channel | Directive |
|---|---|
| fetch / XHR / WebSocket / `sendBeacon` / EventSource | `connect-src` |
| `<img>`, CSS `url()`, favicon (the pixel tracker) | `img-src` |
| `<audio>`/`<video src>` | `media-src` |
| `@font-face url()` | `font-src` |
| `<iframe src>` | `frame-src` |
| form POST to a tracker | `form-action` |
| `<script src>` | `script-src` |
| WebRTC data channel | **not CSP** → bridge neuter |

## 7. WebRTC neuter — closing the CSP blind spot  **[shipped]**

CSP doesn't govern `RTCPeerConnection`, so it's deleted in the bridge before demo
code runs. Robust for our demos precisely because they're opaque-origin: the bridge
runs first (nothing pre-captured a reference), and a child iframe the demo spawns
gets a *different* opaque origin, so `child.contentWindow.RTCPeerConnection` is a
cross-origin access → `SecurityError` (the same isolation that blocks
`window.top.__TAURI_INTERNALS__`). Bundled *with* the internet block — otherwise
"block internet" would have a WebRTC-shaped hole.

## 8. Honest limits

- The block is **coarse** — all-or-nothing per deck. No "allow localhost only" yet
  (§5).
- **No parent `script-src` backstop** in v1 (§4, needs #122). The parent's residual
  protection rests on the closed injection sinks + containment, not CSP.
- **DNS-prefetch** and a few exotic tricks remain theoretical egress edges.
- The real *un*-covered residual (per the security review) is not exfiltration but
  **auto-run + in-box UI-spoof with no origin shown** — a transparency affordance,
  not a CSP concern.

## 9. Files (as shipped)

- `src/lib/preferences.ts` — `demoInternetAccess` pref (master, default ON).
- `src/lib/trustLedger.mjs` / `.d.mts`, `src/lib/trustStore.ts` — per-deck
  `blockInternet` + `isDeckInternetBlocked` / `setDeckInternetBlocked`.
- `src/components/SettingsModal.tsx` — Settings → Security tab.
- `src/components/SecurityPanel.tsx` — deck Security window "Internet" tab.
- `src/lib/demoMount.ts` — `useDemoInternetBlocked()`; thread `blockInternet` through
  `getDemoDocumentUrl` / `buildIsolatedOutputUrl` (+ blob-cache key).
- `src/lib/demoBridge.ts` — the `NET_BLOCK` injection (CSP meta + WebRTC neuter).
- `src/components/notebook/IsolatedOutput.tsx` — passes the flag for notebook output.
- e2e: `netblock-probe.mjs` + `fixtures/make_netblock_deck.py`.

**Deferred / tracked:** app-wide `script-src` via a custom demo protocol (#122);
per-deck allowlist modes, per-demo manifest + approval, violation reporting (§5).
