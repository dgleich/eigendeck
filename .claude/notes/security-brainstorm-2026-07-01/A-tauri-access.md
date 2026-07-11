# A. Stop injected code from reaching Tauri (TAURI-access)

The vector all the XSS findings rely on: injected/inline script running in the
privileged webview can call `__TAURI_INTERNALS__.invoke`.

- **Strict CSP `script-src 'self'` (no `'unsafe-inline'`)** — blocks inline and
  `on*` handlers; the single highest-leverage kill. ~No feature impact (app's own
  bundled code is `'self'`).
- `withGlobalTauri: false` — don't expose the global bridge.
- Per-webview capability allowlist — restrict which Tauri commands the
  deck-rendering webview can invoke at all.
- Render deck content in a **separate low-privilege webview/origin** from the app
  chrome; only chrome may invoke.
- Belt + suspenders: strip `on*` attributes and `javascript:`/`data:` URLs in the
  sanitizer even if CSP lags.

Verdict from discussion: "just ban it" — CSP does this cleanly with no feature loss.
