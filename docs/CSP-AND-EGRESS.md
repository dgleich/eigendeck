# Eigendeck CSP & Demo Network Egress — design

Status: **design, agreed 2026-07-06.** Not yet implemented. Companion to
[`DEMO-PLATFORM.md`](DEMO-PLATFORM.md) (opaque-origin demo isolation) and
[`NOTEBOOK-ISOLATION.md`](NOTEBOOK-ISOLATION.md). Closes audit finding **C-6 / H-6**
(`csp: null`) and specifies an optional, graduated control over where embedded
demos may talk on the network.

Each section marks **[v1]** (the CSP backstop — do now) vs **[deferred]** (the
paranoia layer — designed here, built when wanted).

---

## 1. Purpose & philosophy — default is PERMISSIVE

The point of a CSP here is a **backstop**, not a cage. By the time this lands, the
real attack surface is already closed:

- demos run in an **opaque-origin sandbox** with no line to the app/Tauri/files
  (`DEMO-PLATFORM.md`, audit C-3);
- injection sinks are **sanitized or contained** (`NOTEBOOK-ISOLATION.md`, C-1/2/4/5);
- the webview has **no `fs` capability at all** — all file I/O moved to Rust
  (`project fs-in-rust`).

So a demo reaching the network is **low-risk**: it's opaque-origin, it can't read
your files or app state, it can only fetch. Blocking that by default would break
legitimate demos (a Plotly CDN, a live-data widget) for a threat that's already
contained. **Therefore the default posture is permissive: demos may use the
internet.** The controls in this doc are **opt-in**, for the paranoid, offline
environments, or a specific untrusted deck — never the common case.

The one thing that IS strict by default is `script-src 'self'` — because it costs
nothing (everything is local) and it's the real wall (see §2).

## 2. The always-on baseline CSP  **[v1]**

Everything Eigendeck loads is local — MathJax is the bundled `public/mathjax/`
(-nosre), fonts are bundled, there is no CDN. So a strict `script-src` is free:

```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline';   /* React inline styles + MathJax/theme CSS */
img-src     'self' data: blob:;       /* SQLite-blob images, data URLs */
media-src   'self' data: blob:;
font-src    'self' data:;             /* bundled + data-URL demo fonts */
frame-src   blob:;                    /* embed the opaque-origin demo/notebook iframes */
connect-src 'self' ipc: https: wss: ws://localhost:*;   /* permissive: demos + kernels */
object-src  'none';
```

- **`script-src 'self'`** is the win: an injected `<script>` cannot run (no inline,
  no eval, no remote), so there's nothing to do exfil in the first place. This is
  the C-6 backstop. *One unknown to test: whether MathJax v4 SVG needs
  `'unsafe-eval'`; the -nosre build probably doesn't. If it does, add exactly that
  one token — a 10-minute e2e check (math render).*
- **`style-src 'unsafe-inline'`** is required (React `style=` everywhere); style
  injection is low-risk with `script-src` strict.
- **`connect-src` is deliberately permissive** (`https: wss:`) so demos keep their
  internet by default (§1). This gives up CSP's *exfil* second-wall for the parent
  frame, but `script-src 'self'` remains the primary wall.
- **Blob iframes**: `frame-src blob:` lets the parent embed demos. A `blob:`
  document is its own context with no inherited-script concerns internally — demos
  run exactly as today.

Tauri auto-injects the IPC tokens it needs when a CSP is set; verify the final
merged policy in the running app.

## 3. The mechanism everything rests on: CSP inheritance

A `blob:` document **inherits the embedding page's CSP**, and a document can only
make its policy **more** restrictive, never looser (CSP3 "inherit"; WebKit honors
it). Two consequences drive the whole design:

1. **Per-demo tightening is possible.** We inject the demo document at mount
   (bridge + theme). We can add a `<meta http-equiv="Content-Security-Policy">`
   that *tightens* that one demo's egress, independent of the permissive app policy.
2. **Global lockdown is airtight.** The app-frame CSP is fixed when the window
   loads; nothing at runtime — no deck, no demo — can loosen it. Tighten-only.

## 4. Global internet control (three states)  **[deferred]**

A single global setting, read by Rust **at startup** to select the boot CSP:

- **Allow (default).** Boot with the permissive §2 policy. Per-deck / per-demo
  controls (§5, §6) apply within it (tighten-only). Fully dynamic, no restart.
- **Lockdown (paranoid / offline).** Boot with `connect-src 'self' ipc:` (optionally
  `+ ws://localhost:*` to keep *local* Jupyter kernels while blocking the internet
  — a one-token choice). Parent **and** every demo inherit the lock; nothing can
  loosen it.
- **Restore from lockdown → app restart.** Not a wart — it's the guarantee: because
  the app-frame CSP is boot-baked and tighten-only, a malicious deck cannot escalate
  out of lockdown at runtime. Only a deliberate setting change + relaunch restores
  the network. Reading the pref at boot is *why* the restart is required, which is
  exactly the desired property.

## 5. Per-deck egress modes  **[deferred]**

When global = Allow, each deck (with a global default) picks a mode, enforced by
the CSP `<meta>` we inject into its demos:

- **Open** (default) — inherit the permissive app policy; demos have full internet.
- **Local-only** — inject `default-src 'self'` (+ WebRTC neuter, §7): nothing calls
  home. The "block internet" toggle from `DEMO-PLATFORM.md` §3.
- **Allowlist** — inject `default-src 'self' <hosts>` (+ `connect-src` / `img-src` /
  `form-action` to the same hosts): only the listed hosts (e.g. `http://localhost:*`,
  a specific API/CDN) are reachable; everything else blocked.

## 6. Per-demo network manifest + approval  **[deferred]**

A demo may **declare** what it needs; the user **approves** a subset. Core rule:
**declared ≠ granted** — the declaration is a transparency/consent layer; only the
*approved* hosts enter the enforced CSP allowlist (§5 Allowlist). A demo can never
self-grant by declaring.

**Manifest** — a block near the `<!--eigendeck-demo-v1-->` marker, parsed at ingest:
```html
<script type="application/eigendeck-manifest+json">
{ "network": [
  { "host": "api.stockdata.example", "purpose": "Live stock quotes", "kind": "data-api" },
  { "host": "cdn.plot.ly",           "purpose": "Plotly charting library", "kind": "cdn" }
] }
</script>
```
- **Panel UX** — surface each request per demo: "wants `api.stockdata.example` —
  *Live stock quotes*." Narrow + purposeful → one-click allow. `*` or a dozen hosts
  → visibly flagged, approve individually. `kind` (data-api / cdn / analytics) helps
  the human judge fast. **Purpose is advisory** — you can enforce *hosts*, not *why*.
- **Approvals live in the trust ledger** (the asset-security ledger), keyed by
  deck + demo asset + host — same infrastructure as per-asset path approvals.
- **Enforcement** = approved hosts → the demo doc's injected CSP allowlist. Nothing
  else. So a demo that also bundled a tracker is blocked from it even if it "declared"
  it and you declined that one host.

## 7. WebRTC neuter — closing the CSP blind spot

CSP does not reliably govern `RTCPeerConnection`, so egress via a WebRTC data
channel would otherwise bypass §5/§6. We close it in the **bridge** (which runs at
the top of every demo doc, before demo code):
```js
delete window.RTCPeerConnection;
delete window.webkitRTCPeerConnection;
delete window.RTCDataChannel;
```
This is **robust** for our demos, not a naive delete, precisely because they're
opaque-origin: the bridge runs first (nothing pre-captured a reference), and a
child iframe the demo spawns gets a *different* opaque origin, so
`child.contentWindow.RTCPeerConnection` is a cross-origin access → `SecurityError`
(the same isolation that blocks `window.top.__TAURI_INTERNALS__`, verified in the
demo e2e). A slide demo has essentially no legitimate WebRTC use, so neuter it
whenever egress is anything other than Open (Local-only / Allowlist), or always.

## 8. Directive → exfil-channel map (for the allowlist)

Locking `default-src` to the allowlist covers most of these as the fallback; set
`form-action` explicitly.

| Channel | Directive |
|---|---|
| fetch / XHR / WebSocket / `sendBeacon` / EventSource | `connect-src` |
| `<img>`, CSS `url()`, favicon (the pixel tracker) | `img-src` |
| `<audio>`/`<video src>` | `media-src` |
| `@font-face url()` | `font-src` |
| `<iframe src>` | `frame-src` |
| form POST to a tracker | `form-action` |
| `<script src>` | `script-src` (`'self'`) |
| WebRTC data channel | **not CSP** → bridge neuter (§7) |

## 9. Violation reporting  **[deferred]**

Set `report-to` so a blocked request emits a CSP violation report. This turns the
manifest from a passive promise into **tamper-evidence**: a demo that tries to reach
an undeclared / unapproved host is caught the moment it tries — surface it as
"⚠️ this demo attempted an undeclared connection to `analytics.example`." Strong
trust signal.

## 10. Honest limits

- **`script-src` is the real wall; permissive `connect-src` gives up the parent's
  exfil second-wall** in the default posture (by design — demos need internet).
- **Approval quality is human-in-the-loop** — a malicious demo can declare a
  plausible-sounding tracker host; you have to judge. Violation reporting (§9)
  catches *undeclared* reach, not a lie you approved.
- **WebRTC** closed by §7; **DNS-prefetch** and a couple of exotic tricks remain
  theoretical edges.
- **Purpose strings** are advisory (host-enforced, not purpose-enforced).

## 11. Phased delivery

- **[v1] — the C-6 backstop.** Ship the always-on baseline CSP (§2): strict
  `script-src 'self'`, permissive `connect-src`. Verify via the render e2e (math,
  demos, notebooks, images); add `'unsafe-eval'` only if MathJax needs it. This is
  the whole security payoff; default stays permissive, nothing user-visible changes.
- **[deferred] — the paranoia layer.** Global lockdown toggle (§4), per-deck egress
  modes (§5), per-demo manifest + approval (§6), WebRTC neuter (§7), violation
  reporting (§9). Built when there's demand; not needed to close the audit.

## 12. Files

- `src-tauri/tauri.conf.json` — set `app.security.csp` (§2). *[v1]*
- `src-tauri/src/lib.rs` — read the global internet pref at startup, select boot CSP
  (§4). *[deferred]*
- `src/lib/demoMount.ts` / `demoBridge.ts` — inject the per-demo CSP `<meta>`
  (§5/§6) and the WebRTC neuter (§7). *[deferred]*
- `src/lib/assetTypes.mjs` (+ ingest) — parse the demo manifest (§6). *[deferred]*
- trust ledger (`trustLedger.mjs` / `trustStore.ts`) — network-host approvals (§6).
  *[deferred]*
- security panel — egress mode + per-demo approval UX (§5/§6/§9). *[deferred]*
