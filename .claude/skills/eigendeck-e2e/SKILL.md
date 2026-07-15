---
name: eigendeck-e2e
description: Set up and run headless end-to-end (e2e) tests for the Eigendeck Tauri desktop app on Linux — driving the REAL built app via tauri-driver + WebKitWebDriver + xvfb. Use when running the e2e/ scenarios, writing a new e2e test for a feature, debugging a frontend↔Rust boundary bug, or re-provisioning the e2e toolchain after a container reset.
---

# Eigendeck end-to-end (e2e) testing

**e2e = end-to-end:** exercise the whole stack — the real built app, its
WebKitGTK WebView, real `invoke` calls, real SQLite — instead of mocked
units. This catches frontend↔Rust boundary bugs (overlay load/merge/persist,
the duplicate→sync/junction flow, save→reopen round-trips) that vitest with
mocked `invoke` cannot.

**Linux only.** `tauri-driver` has no macOS support, so this runs in this
container / CI, never the user's Mac dev loop. The container occasionally
resets — re-run the Provision steps below when tools are missing.

## 0. Quick check — is it already set up?

```bash
command -v Xvfb /usr/bin/WebKitWebDriver ~/.cargo/bin/tauri-driver ~/.cargo/bin/cargo
ls /tmp/el-target/debug/eigendeck 2>/dev/null   # the Linux app binary
```

## 1. Provision (after a container reset)

Rust toolchain (cargo lives at `~/.cargo/bin/cargo`, NOT on PATH):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
~/.cargo/bin/rustup component add clippy
```

Tauri build deps + e2e deps (apt; `sudo` works, uid is non-root):
```bash
sudo apt-get update
sudo apt-get install -y pkg-config libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libsoup-3.0-dev libssl-dev librsvg2-dev \
  libxdo-dev libayatana-appindicator3-dev \
  xvfb webkit2gtk-driver               # xvfb + WebKitWebDriver
~/.cargo/bin/cargo install tauri-driver   # WebDriver bridge (slow, ~minutes)
```

Node 20 is preinstalled. All `cargo` and long network builds need
`dangerouslyDisableSandbox: true` on the Bash tool, and the cargo binary is
`~/.cargo/bin/cargo` (not on PATH).

## 2. Build the app (Linux)

Use an **isolated** `CARGO_TARGET_DIR` (`/tmp/el-target`). `/work` is a
shared mount with the user's Mac; `src-tauri/target/debug/eigendeck` there is
often a **Mach-O (macOS) binary** that won't run on Linux, and building into
the shared dir clobbers their Mac artifacts.

```bash
cd /work
npm install                 # if node_modules missing
npm run setup               # copy MathJax bundle into public/ (gitignored)
VITE_EIGENDECK_SEAM=1 npm run build   # produce dist/ WITH the automation seam
cd src-tauri
CARGO_TARGET_DIR=/tmp/el-target ~/.cargo/bin/cargo build --bin eigendeck      # the app
CARGO_TARGET_DIR=/tmp/el-target ~/.cargo/bin/cargo build --bin eigendeck-cli  # fixtures
```

App binary → `/tmp/el-target/debug/eigendeck` (this is `E2E_APP`).
CLI → `/tmp/el-target/debug/eigendeck-cli` (builds fixture decks).

> **Rebuild `dist/` after every frontend change** — the harness serves
> `dist/`, so a stale `dist` runs old code. (The bin only needs rebuilding
> for Rust changes.)
>
> **`VITE_EIGENDECK_SEAM=1` is REQUIRED** (not optional). Every probe drives
> the app through `window.__eigendeck` (the live store + `flush`/`save`). That
> seam is **dev/test-only** — it installs only on a Vite dev build
> (`import.meta.env.DEV`) or when this build flag is set. A plain
> `npm run build` tree-shakes the install out entirely, so probes time out
> waiting for the seam (`waitSeam` never returns / "deck never opened"). It is
> NOT a runtime preference — you cannot enable it from Settings or
> localStorage (and `run.sh` wipes `XDG_DATA_HOME` per run anyway). The flag
> must be baked into the `dist/` the harness serves. See `src/App.tsx`.

## Seam discipline — DO NOT put app logic behind the seam

**A seam may ONLY exist to work around an interaction WebDriver genuinely cannot
perform** — chiefly the native OS dialogs (file **Open / Save / picker / New**) and
the read/observe + save-in-place that replace them. That's it.

**A seam must NEVER invoke or reimplement application behaviour** (trust a deck, approve
a file, relocate, revoke, etc.). Doing so creates a *parallel code path*: the probe runs
the seam's copy of the logic and goes green while the **real UI is broken** — because
the seam skips the actual plumbing (event round-trips, separate windows, deck save,
store wiring). This is the same "divergence" hazard we guard against in app code, in the
*test* layer. It really bit us: the asset-security `trust`/`approve` action-seams passed
while clicking "Trust this deck" in the real Security window didn't persist at all.

Rules of thumb:
- **Bypass (OK):** `store` (read to assert; drive input the UI would), `save()`/`flush()`
  (stand in for the Save dialog / autosave), `exportHtml()` (dialog-free export),
  `captureElement()` (WebDriver `/screenshot` hangs), `missingAssets()` (observe).
- **Reimplement (NOT OK):** any seam that *performs* a user action with its own logic
  instead of clicking the real control. Drive the real button; for a second Tauri
  window, switch to its WebDriver window handle (`GET /session/{id}/window/handles` →
  `POST /session/{id}/window`) and click there — see `e2e/security-window-handle-spike.mjs`.
- If you're tempted to add an action seam "so the probe is simpler," that's the smell:
  the probe should drive the real control so it exercises the real path.

### Driving the real UI (helpers + hard-won gotchas)

`e2e/_ui.mjs` has the shared real-UI drivers (open app, window-handle switch, the
Security window trust/approve/revoke, `dragElementToX`). Use them instead of seams.
Gotchas that cost hours (all encoded in `_ui.mjs`):

- **Identify the main window by the `__eigendeck` seam, never by handle index.**
  Opening/closing windows reorders handles; a leftover Security window at `handles[0]`
  gets mistaken for main and every subsequent action targets the wrong window
  (`findMainHandle`).
- **Close a second window via its REAL control** (the Security window's `×` button).
  A probe-side `import('@tauri-apps/api/...')` of a **bare specifier fails at runtime**
  (only the app's bundled imports resolve), so programmatic `WebviewWindow.close()`/
  `getCurrentWebviewWindow().close()` from `execute/sync` silently no-ops. A window that
  won't close gets **reused with its stale first-mount report**.
- **The ledger cache is per-window.** After the Security window mutates it, the main
  window must invalidate before reading (`invalidateLedgerCache`, wired to
  `eigendeck:security-changed`) — else it reads stale approvals. (This was a real bug the
  action-seams masked.)
- **The Security window builds its report from the SAVED deck.** If a probe changes the
  deck via a raw `invoke` (e.g. `db_store_asset`), `save()` before opening the window or
  it'll show stale linked paths.
- **Settle after `switchTo` a FRESH 2nd window before reading.** A just-loaded webview
  can return an empty `document.body.textContent` for a beat right after the handle
  switch — wait/retry until the EXPECTED content appears; don't assert on the first read
  (this silently failed `settings-window-probe` with `got: <empty>`). And assert on real
  BODY text, not the window title: the Settings window's title is `document.title`
  ("Eigendeck — Settings"), while its body has the tabs (`General` / `Jupyter servers`) —
  `body.textContent` never contains the word "Settings".
- **Second windows (settings/security) ARE drivable — the old "opening a 2nd window
  crashes WebKitWebDriver" note is stale** (that was the *projector* window path, a
  different case). `getWindowHandles`/`switchToWindow` work; see `_ui.mjs` +
  `security-window-handle-spike.mjs`.
- **System-dialog stand-ins are the sanctioned exception.** `src/lib/filePicker.ts`
  reads `window.__eigendeckPickFile` (dev/seam builds only) so a probe can drive the real
  "Relocate…" button + handler without the native picker — the ONE blocked step is
  stubbed, the app logic still runs. `src/lib/confirmDialog.ts` is the same pattern for a
  native confirm (`window.__eigendeckConfirm`, e.g. "Stop trusting this deck").
- **You CAN screenshot to verify layout.** `GET /session/{id}/screenshot` returns a
  base64 PNG of the CURRENT window and works for normal windows (incl. the Security
  window — switch to its handle first). Decode with `Buffer.from(v,'base64')` → a `.png`
  you can open/view. The `/screenshot` HANG is specific to PRESENT MODE's fullscreen
  compositing; that's the only case needing the `captureElement` seam (modern-screenshot).
  Screenshotting the real window catches layout bugs (redundant lines, bad spacing) that
  DOM assertions miss.

## 3. Run a scenario

```bash
# build a fixture deck (a notebook whose overlay edits a cell)
python3 e2e/fixtures/make_overlay_deck.py single /tmp/ov.json
/tmp/el-target/debug/eigendeck-cli /tmp/ov.eigendeck import json /tmp/ov.json

# open it via the launch-arg seam and assert the DOM
E2E_APP=/tmp/el-target/debug/eigendeck \
E2E_DECK=/tmp/ov.eigendeck \
E2E_EXPECT=EDITED_OVERLAY_MARKER E2E_ABSENT="k = 5" \
  bash e2e/run.sh
# -> "E2E_PASS ..." / exit 0
```

`e2e/run.sh` starts `xvfb` + a static server for `dist/` on :1420 + the
`tauri-driver`, then runs `e2e/check.mjs`. `check.mjs` creates a WebDriver
session that launches the app **with the deck path as an argument** (no
native Open dialog), polls `document.body.textContent` for `E2E_EXPECT`, and
fails if `E2E_ABSENT` appears.

## 4. Critical gotchas (these cost hours)

1. **WebKitGTK caches the JS bundle across runs** → silently serves STALE
   frontend code. `run.sh` already exports a throwaway `XDG_CACHE_HOME`/
   `XDG_DATA_HOME` per run to defeat this. Any new runner MUST do the same.
2. **Debug build loads `devUrl` (`localhost:1420`)**, not the embedded
   `dist`. That's why `run.sh` serves `dist/` on :1420. A `--release` build
   is self-contained — for a CI job, build release and drop the server.
3. **Native dialogs can't be driven** (Open / Save As / New Project). Work
   only through dialog-free paths:
   - **Open** a deck by passing its path as a launch arg (`tauri:options.args`).
   - **Save** in place with Cmd+S (dispatch a keydown — see below) or rely
     on autosave; both avoid the dialog when the deck already has a path.
4. **`tauri-driver` isn't on PATH** in `bash -c` subshells — resolve it
   (`run.sh` uses `command -v tauri-driver || ~/.cargo/bin/tauri-driver`).
5. **Headless WebKit env**: set `WEBKIT_DISABLE_COMPOSITING_MODE=1`,
   `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `LIBGL_ALWAYS_SOFTWARE=1` (run.sh does).
6. **The seam does NOT author+save decks — it persists almost nothing** (this
   cost a full session; the deck shipped to users opened BLANK). Building a deck
   by driving the store — `store.getState().addElement(...)` over WebDriver then
   `window.__eigendeck.save()` — does not work: `save()`→`flushToSqlite` only
   replays **deltas tracked by a store-subscription diff** in `presentation.ts`
   (`addedElements`/`addedSlides`/…), and bulk programmatic adds aren't reliably
   tracked, so the flush writes ZERO elements. Assets still persist (they go
   straight through `invoke('db_store_asset')`), so the tell-tale signature is
   **"assets embedded but slides blank."** The deck keeps whatever elements it
   had on disk (e.g. the template you copied from). **Build decks with the
   `eigendeck-cli` skill's `import json`** (fresh in-memory DB, atomic write, no
   flush). Use the seam to DRIVE + ASSERT, and to EXPORT read-only
   (`exportHtml()`) — never to author and `save()`.
7. **Verify persistence in the SAVED FILE, not the live session.** Same-session
   DOM / screenshots read the in-memory store, which is correct even when the
   file is empty — so a screenshot "looks right" while the saved deck is blank.
   Reopen in a fresh session, or inspect the DB:
   `select type,count(*) from elements where valid_to is null group by type`
   (and check `slide_elements` / `asset_id` resolve). A correctly-built deck
   reopens fine; "blank on reopen" means it was never written, not a timing race.
8. **`exportHtml()` can't render MathJax headlessly.** In-app *display* renders
   math, but the export's `renderMathPerBundle` (iframe pool) silently
   `.catch`-falls back to raw `$...$`. For math that must appear in an exported
   deck, pre-render it: add a math text element, wait, scrape
   `document.querySelector('[data-c]').closest('svg').outerHTML` (NOT
   `mjx-container` — the wrapper is stripped), and embed it as an SVG image /
   inline SVG (it uses `fill="currentColor"` + `ex` units).
9. **`pkill -f "tauri-driver"` (or `…WebKitWebDriver` / `…http.server 1420`)
   self-kills your shell** — `-f` matches your own command line, which contains
   the pattern string → SIGKILL (rc 137, no output). `run.sh` anchors the
   pattern (`-f "^<bin>"`); ad-hoc commands should use `pkill -x <comm>` and
   `fuser -k 1420/tcp` instead.
10. **WebDriver `GET /session/{id}/screenshot` HANGS once the app is presenting**
    (headless WebKitGTK compositor wedges on the fullscreen present overlay + its
    `srcdoc` iframes; editor-mode screenshots are fine). #134. Do NOT `/screenshot`
    a present slide — capture pixels through the seam instead:
    `window.__eigendeck.captureElement('.present-slide')` returns a `domToDataUrl`
    PNG in-process, no compositor snapshot. Verify non-blank by drawing it to a
    canvas and counting distinct colors (a blank stage is one flat color) — see
    `e2e/present-visual-probe.mjs`. Also assert the stage rect isn't 0×0 (the #137
    collapsed-stage regression). If you must call `/screenshot` in present, wrap it
    in an `AbortController` timeout so a hung capture doesn't wedge the probe.

## PDF rendering in the rig (pdfium dylib location)

PDF rendering (`db_render_pdf_page` → pdfium) fails in the bare-binary rig with "pdfium
dylib not found. Checked: /usr/lib/Eigendeck/resources/pdfium/libpdfium.so". The debug
binary's `resource_dir()` resolves to the Linux INSTALL path (`/usr/lib/Eigendeck`), not
the build's `resources/`, so the bundled lib isn't found. It's a rig/packaging detail,
NOT a code bug (a packaged app bundles it correctly). To exercise PDF rendering headlessly,
put the lib where `resource_dir()` looks:
```bash
sudo mkdir -p /usr/lib/Eigendeck/resources/pdfium
sudo cp src-tauri/resources/pdfium/libpdfium.so /usr/lib/Eigendeck/resources/pdfium/
```
Then drive `invoke('db_render_pdf_page', {assetId, page:0, maxWidth, maxHeight})` and
assert the returned bytes are a PNG. Rebuild the torture deck (55 embedded PDFs) with
`python3 tools/build_pdf_stress_test.py` (reads gitignore/test-pdfs/*.pdf).

## 5. Writing a new e2e for a feature

- **Fixture:** craft the deck via `eigendeck-cli ... import json <file>` —
  NOT by scripting the editor through the seam (see gotcha 6: seam `save()`
  won't persist programmatic adds). The presentation JSON can embed `assets[]`
  (base64) — see `db_export_json_with_assets` and
  `e2e/fixtures/make_overlay_deck.py` (it builds notebook + overlay assets,
  incl. owner_element_id sidecars).
- **Drive the UI** via WebDriver `execute/sync` (POST
  `/session/{id}/execute/sync`, body `{script, args:[]}`):
  - click: `document.querySelector("[title='Duplicate']").click()`
  - Cmd+S: `window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,ctrlKey:true,bubbles:true}))`
  - read state: `return document.body.textContent`
- **Assert** via the DOM (text markers) or by inspecting the saved
  `.eigendeck` with `python3 -c "import sqlite3; ..."` (current rows have
  `valid_to IS NULL`). Inspecting the DB is the most reliable check for
  storage/sync/overlay behavior.
- Copy `e2e/check.mjs` for a parameterized DOM assertion, or write a
  bespoke `.mjs` (see git history `/tmp/e2e_*.mjs` patterns) for multi-step
  flows (load → click → save → re-assert).
- Add the scenario invocation to `e2e/README.md`.

## 6. Files

- `e2e/run.sh` — xvfb + dist server + tauri-driver + node runner.
- `e2e/check.mjs` — parameterized: `E2E_DECK`/`E2E_EXPECT`/`E2E_ABSENT`.
- `e2e/fixtures/make_overlay_deck.py` — notebook+overlay deck generator.
- `e2e/README.md` — scenarios + prereqs.
- Findings/edge cases: `.claude/notes/notebook-edge-cases-findings.md`.
