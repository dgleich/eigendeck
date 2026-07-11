# C. Demo iframe isolation (DEMO-iframes)

Demos run with `sandbox="allow-scripts allow-same-origin"` over a same-origin
`blob:` URL → sandbox defeated, demo JS reaches `window.top` and Tauri.

- **Drop `allow-same-origin`** → opaque origin per piece; can't read `up`.
- Move theme injection to **build-time** (into the srcdoc we author) instead of
  reading `iframe.contentDocument`.
- Preview/thumbnail capture via `postMessage` snapshot, or fall back to placeholder.
- **Egress control on demos**: even isolated, a demo can `fetch()` out — restrict
  with CSP `connect-src` or a per-demo network allowlist (this is what actually
  blocks exfil, vs. just parent-isolation).

## Multipart-demo transport (opaque origins break BroadcastChannel)
Only `harper_electron` streams (rAF ~60 fps); all other 11 demos are event-driven /
one-shot bulk — trivially relayable.

- **MessagePort** — parent mints channels and transfers ports into pieces; pieces
  then talk **directly**, bypassing the parent (works across opaque origins because
  a port is a transferable capability, not origin-keyed). Preferred.
  - Shapes: full **mesh** (N-1 ports each, no hub) · **star** through a dumb
    fan-out broker (parent or a hidden broker frame; reproduces BroadcastChannel
    "everyone hears it" semantics).
- Plain **parent relay** — simple fallback; fine for 11/12.
- Refactor streaming demos (harper) to **event-driven + local rAF** so nothing
  streams cross-frame.
- `BroadcastChannel`-compatible **shim** injected into the srcdoc so demos need
  ~no edits.
- **Per-instance channel keying** (fixes today's cross-instance bleed) + broker
  **retains last state** for late-joining pieces (thumbnails, present mode).
- Handshake: buffer sends until the port arrives; re-transfer ports on every
  iframe (re)mount.
