# Debugging packaged-app YouTube + the loopback shim fix (07-14)

Second arc of the day (after the e2e multi-window merge). Chased down why YouTube
embeds fail in the *installed* app but work in `tauri dev` (#149), landed on the
root cause, security-reviewed a fix, and built most of it. Branch
`feat/youtube-embed-shim`; tracked as #152.

## The debugging (live, on the user's Mac)

The rig can't reproduce this — it serves the dev origin — so the whole diagnosis
ran through the packaged app's Web Inspector. Key enabler: the release build ships
`tauri = { features = ["devtools"] }` + a **Developer Tools** menu item
(Cmd+Alt+I), so the installed app is inspectable with no rebuild. I fed the user
`gitignore/yt-console-test.sh` snippets (pbcopy → paste into the console, since the
WKWebView console won't copy) that reloaded the live iframe with one variable
changed at a time.

Findings, in order:
- `location.origin = "tauri://localhost"` in the packaged app (vs
  `http://localhost:1420` in dev). That's the only thing that changes.
- Removing `enablejsapi=1`, `referrerpolicy="no-referrer"`, and switching
  `youtube-nocookie.com` ↔ `youtube.com` all **failed** — the frame kept showing
  YouTube's black "Watch on YouTube" refusal.
- The `qoe`/`log_event` "access control checks" console errors are non-fatal
  YouTube telemetry, not the cause.
- **Vimeo and PeerTube both play fine from `tauri://`** — so the problem is
  YouTube-specific.

## Root cause + research

YouTube's embed player requires a valid **http(s) origin/Referer** to authorize
inline playback; the packaged custom scheme `tauri://localhost` provides neither,
and that scheme is **not changeable** on macOS/Linux (`use_https_scheme` is
Windows/Android only — confirmed in the tauri-utils config source). A research
agent found this is filed upstream as **tauri#14422** and that the community fix is
a loopback shim (the same pattern that fixes YouTube Error 153 in Capacitor/iOS).
Serving the whole app from `localhost` (tauri-plugin-localhost) also works but
moves the privileged IPC frame onto an http origin and breaks `invoke()` — rejected.

## The design + security review

**Option A (chosen):** a tiny Rust HTTP server on `127.0.0.1:<ephemeral>` that
serves ONE token-gated route hosting only the YouTube iframe. The app frames
`http://127.0.0.1:<port>/yt/<token>/<id>`, whose http origin YouTube accepts; the
main window stays on `tauri://localhost` so IPC is untouched. Design + threat model
in `docs/youtube-embed-shim.md`.

A security-review agent returned **GO with conditions** (9 must-dos). Sharpest
catch: the YouTube id was **unvalidated** today (raw `?v=`), which the shim would
turn into an HTML-injection sink over data that arrives in shared decks.

## Built (steps 1–3, 5, 6 — all committed + verified)

1. **id validation** — `detectVideoProvider` now enforces the canonical 11-char
   `[A-Za-z0-9_-]` shape; malformed → null. Closes the latent gap regardless of the
   shim. Tests updated to real 11-char ids + rejection cases.
2. **Rust shim** (`src-tauri/src/youtube_shim.rs`, `tiny_http`) — 127.0.0.1-only
   bind, 256-bit per-launch token, Host-header allowlist (anti-DNS-rebinding),
   11-char id allowlist, GET-only, no CORS, restrictive response CSP + nosniff +
   no-store, panic-safe. Exposed via the `youtube_shim_base` command. Rust unit
   tests.
3. **frontend wiring** (`src/lib/youtubeShim.ts`) — routes YouTube through the shim
   only when `location.protocol === 'tauri:'`; Vimeo/PeerTube/dev/Windows unchanged.
5. **scoped ATS** — `NSExceptionDomains` for 127.0.0.1 + localhost in `Info.plist`
   (NOT the global flag, which would erode demo/notebook network containment).
6. **e2e probe** (`e2e/youtube-shim-probe.mjs`) — drives the real app + hits the
   loopback server from node; asserts the iframe page + every hardening check
   (id/Host/token/method/no-CORS/CSP/nosniff). PASSES; added to the run-all manifest.

Full vitest (1323) + Rust tests + clippy + build stay green.

## Step 4 (app CSP) — deferred, and why the user's instinct was right

The one remaining review must-do is the app's first top-level CSP. The user pushed
back: "don't we need a broad CSP so demos that access the internet work?" — and
that's exactly the wall. It turns out this is **already documented + rig-tested** in
`docs/CSP-AND-EGRESS.md §4`: demos mount from `blob:` URLs, a `blob:` document
**inherits the embedding page's CSP** (CSP3, WebKit honors it), so a strict app
`script-src`/`connect-src` is inherited by every demo and clamps its inline code +
CDN scripts + `fetch` regardless of the demo's own CSP (a strict `script-src 'self'`
was tried and gave `NBSEC_FAIL`). The real fix is serving demos from a custom Tauri
protocol so they stop inheriting the parent CSP — tracked in **#122**. So the app
CSP stays gated on #122; the shim doesn't need it (`csp: null` already permits the
loopback frame, and the shim page carries its own response-header CSP). Cross-linked
in `CSP-AND-EGRESS.md §5` and `youtube-embed-shim.md`.

## Remaining

- **Packaged-macOS sign-off** — build a local `.app` (`npm run tauri build`, no
  release needed) and confirm YouTube plays through the shim; the rig can't exercise
  the `tauri:`-scheme activation path. Then the branch is mergeable.
- Also filed **#151** this arc: the small `.eigendeck` proxy/document icon isn't
  showing in the packaged app (packaging/wiring bug, distinct from the #148 large-icon
  redesign).
