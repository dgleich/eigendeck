# YouTube embed loopback shim (packaged-app fix)

## Problem

YouTube embeds (`<iframe src="https://www.youtube-nocookie.com/embed/<id>">`) play in
`tauri dev` but show YouTube's black **"Watch on YouTube"** refusal in the packaged
app. Confirmed root cause: YouTube's embedded player requires a valid **http(s)
origin / Referer** to authorize inline playback. In dev the frontend origin is
`http://localhost:1420` (accepted); in the packaged app it is the custom scheme
`tauri://localhost` (rejected), and that scheme is **not changeable** on macOS/Linux
(`use_https_scheme` is Windows/Android only). Upstream: tauri#14422.

Confirmed NOT fixes (all tested live in the packaged app's Web Inspector): removing
`enablejsapi=1`, `referrerpolicy="no-referrer"`, and switching
`youtube-nocookie.com` ↔ `youtube.com`. The `/api/stats/qoe` and
`/youtubei/v1/log_event` "access control checks" console errors are YouTube
telemetry and are non-fatal (they appear on working embeds too).

**Scope: YouTube only.** Vimeo and PeerTube were both verified to play fine from
`tauri://localhost`, so they keep going direct. Only YouTube needs re-parenting.

## Solution — Option A: a static loopback shim (chosen)

Run a minimal HTTP server bound to `127.0.0.1` on an **OS-assigned ephemeral port**
inside the Rust process. It serves ONE token-gated route that returns a tiny HTML
page whose only content is the YouTube iframe:

```
tauri://localhost (app, privileged)
  └─ iframe  http://127.0.0.1:<port>/yt/<token>/<id>   (our shim — static)
        └─ iframe  https://www.youtube-nocookie.com/embed/<id>   (YouTube plays)
```

YouTube now sees an `http://127.0.0.1` parent origin/Referer and plays. The **main
window stays on `tauri://localhost`**, so Tauri IPC and capabilities are untouched.
This is why the shim beats serving the whole app from localhost (which moves the
privileged IPC frame onto an http origin reachable by any web page, and breaks
`invoke()` — see tauri#14422 / #11934).

Only YouTube embeds are re-parented, and only when the frontend is on the custom
scheme (packaged macOS/Linux). Dev (`http://localhost`) and Windows go direct.

## Why this doesn't erode "contain, don't authorize"

The video element **already** reaches the public network today: the live embed
iframe (`SlideElementRenderer.tsx`) has no `sandbox` and points straight at
`youtube-nocookie.com`. The shim re-parents that existing egress through a static
loopback page; it adds a *local* server + *config* surface, not a new class of
remote reach. The shim authorizes nothing, carries no app data, exposes no IPC, and
serves only a fixed YouTube-iframe page. Security review verdict: **GO with
conditions** (below).

## Threat model / required hardening (non-negotiable)

From the design security review. Each is a ship-blocker.

1. **Strict id allowlist in Rust** — reject unless `^[A-Za-z0-9_-]{11}$` (YouTube id
   shape), return 400 otherwise. The id arrives in shared `.eigendeck` decks and is
   currently unvalidated (`?v=` is taken raw), so the shim would otherwise be an
   HTML-injection sink. Attribute-encode as a second layer. Also harden the id in the
   existing `detectVideoProvider` (latent gap regardless of the shim).
2. **Host-header allowlist** — accept only `Host: 127.0.0.1:<port>` / `localhost:<port>`;
   reject anything else. Anti-DNS-rebinding.
3. **No CORS header** — never emit `Access-Control-Allow-Origin`, so a malicious web
   page that hits the port gets an opaque body it cannot read.
4. **128-bit per-launch token in the path** (`/yt/<token>/<id>`), in memory only,
   never logged / on disk / in argv. Turns "any web page can scan for + fingerprint
   the shim" into "must guess 128 bits."
5. **Scoped ATS `NSExceptionDomains` for `127.0.0.1` + `localhost`** in the packaged
   Info.plist — NOT the global `NSAllowsArbitraryLoadsInWebContent` (which would
   re-permit plain-http for the currently network-contained demo/notebook/html
   iframes app-wide). macOS only.
6. **Tight app CSP** — introduce `app.security.csp` (none today). `frame-src`
   `http://127.0.0.1:* http://localhost:* https://www.youtube-nocookie.com
   https://www.youtube.com https://player.vimeo.com <peertube-origins>`; add
   `object-src 'none'`, `base-uri 'none'`. Derive `script-src`/`connect-src`/
   `style-src` from what the app actually loads (MathJax, blob/data demos) and verify
   nothing breaks. (Ephemeral port can't be pinned into static CSP, so the loopback
   host uses a `127.0.0.1:*` wildcard; the token path is the real access control.)
7. **Restrictive CSP + `nosniff` + frame-ancestors on the shim page itself**, served
   as headers by the Rust server (`default-src 'none'; frame-src <youtube hosts>`).
8. **Server hardening** — GET/HEAD only, single exact-path match, never touch the
   filesystem, request size/time limits (Slowloris), panic-safe handler, bind
   `127.0.0.1` only, capped threads, shut down on app exit.
9. **Per-platform gating** — don't apply the macOS ATS block to Linux/Windows; on
   Windows the shim is unnecessary (`use_https_scheme` there); confirm the
   loopback-http subframe on the WebKitGTK e2e rig. All platforms still need the CSP
   `frame-src` entry.

## Implementation steps

Each step is an independently green, committable increment.

1. **Harden the YouTube id** in `src/lib/videoEmbedParse.mjs` (`detectVideoProvider`
   returns a YouTube result only if the id matches `^[A-Za-z0-9_-]{11}$`; graceful
   null fallback). Unit tests. Useful on its own, independent of the shim.
2. **Rust shim server** — new module (e.g. `src-tauri/src/youtube_shim.rs`):
   `tiny_http` on `127.0.0.1:0`, tokenized single route, id + Host allowlists,
   method/path checks, response CSP + `nosniff` + frame-ancestors, panic-safe, no
   CORS, shutdown on exit. A Tauri command exposes the base URL / `{port, token}` to
   the frontend. Rust unit tests for the handler (id/host/method/path).
3. **Frontend wiring** — a small module that, only on the custom-scheme origin,
   fetches the shim base once and rewrites the YouTube embed `src` to the shim URL in
   the live render paths (`SlideElementRenderer` live embed + `PresentSlide`).
   Dev/Windows/non-tauri origins go direct.
4. **App CSP** — add the tight `app.security.csp`; verify `npm run build`, vitest, and
   the e2e rig (MathJax, demos, present) still pass.
5. **ATS** — scoped `NSExceptionDomains` in `src-tauri/Info.plist` (macOS).
6. **Verification** — a WebKitGTK e2e probe that invokes the shim command, fetches the
   loopback URL, and asserts it returns the YouTube-iframe page + rejects a bad id +
   rejects a bad Host (the server hardening is testable headlessly even though the
   rig's dev origin means the *activation* path only runs in the packaged app). Final
   packaged-macOS sign-off is on the Mac.

## Status

Branch `feat/youtube-embed-shim`, tracking #152 (from #149).

- **Step 1 — id validation — DONE** (`detectVideoProvider` enforces the 11-char shape).
- **Step 2 — Rust shim server — DONE** (`youtube_shim.rs` + `youtube_shim_base`,
  all hardening, Rust unit tests).
- **Step 3 — frontend wiring — DONE** (`youtubeShim.ts`; routes YouTube through the
  shim only on the `tauri:` scheme; Vimeo/PeerTube/dev unchanged).
- **Step 5 — scoped ATS exception — DONE** (`Info.plist`, 127.0.0.1 + localhost only).
- **Step 6 — headless verification — DONE** (`e2e/youtube-shim-probe.mjs` PASSES:
  server serves the iframe; id/Host/token/method/no-CORS/CSP/nosniff all enforced).

Remaining:
- **Step 4 — app CSP — TODO** (ship-blocker per the review). Introduces the app's
  first CSP. **Open decision:** PeerTube is federated (arbitrary instance origins),
  so a strict `frame-src`/`connect-src`/`media-src` allowlist cannot enumerate it
  without breaking PeerTube embeds + oEmbed thumbnails. Either allow `https:` broadly
  for those directives (weaker, non-breaking) or accept degraded PeerTube. Needs the
  full WebKitGTK e2e rig to verify MathJax/demos/notebooks/present/export don't
  regress (jsdom can't enforce CSP). Best handled as its own focused pass. Note the
  shim FUNCTIONS without this (today's `csp:null` already permits the loopback frame);
  the CSP is hardening, required before a release ships the shim.
- **Packaged-macOS sign-off** — build a signed `.app` and confirm YouTube actually
  plays through the shim (the rig serves the dev origin, so it can't exercise the
  `tauri:`-scheme activation path).
