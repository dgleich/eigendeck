# Mac-assed native shell — design + plan

Branch: `feat/mac-native-shell`. Goal: make Eigendeck feel like a native macOS app
(pfandrade "mac-assed" checklist + simonlou inspector notes + Aguzman checklist in
memory) WITHOUT breaking Linux/Windows. Native bits sit behind
`#[cfg(target_os = "macos")]`; the HTML toolbar is the cross-platform fallback.

## Verification split (Linux container can't run/compile AppKit)
- **Here (Linux, WebKitGTK):** D, E, F, C-css; `cargo check` of non-macOS Rust; vitest.
- **Mac (MAC-BUILD loop, user builds):** A, B, C-native. I author the objc2 code;
  user runs `bash tools/mac-build.sh` and reports.

## Existing hooks (confirmed)
- objc2 already bridges the Tauri `NSWindow`: `lib.rs:247` `window.ns_window()` →
  `&NSWindow`, sets window level. Cargo has objc2-app-kit (NSWindow etc.).
- Security window pattern: `WebviewWindow` label + `security:ready`/`security:init`
  handshake (`src/lib/securityWindow.ts`, `security.html`, `src/security.tsx`).
- Native menu + accelerators exist (`lib.rs` MenuBuilder, `CmdOrCtrl+…`).
- Settings is currently a **modal** (`SettingsModal`, `App.tsx` `settingsOpen`).

---

## STATUS 2026-07-08 (branch feat/mac-native-shell, local)
- D Settings window — DONE + unit + e2e (65b5ebf, 8ca7bc2)
- E Keyboard shortcuts — DONE + unit + e2e (de770ab)
- F Right-click targeting — DONE + unit + e2e (f5926a2)
- C Inactive-window subtlety — DONE + unit (e25ef0d); visual = Mac check
- A Proxy icon + filename — DONE, native authored + Rust tests (0e0c16a); Mac smoke §A
- B Native NSToolbar — frontend bridge DONE + unit (4c6c019); NATIVE toolbar
  specified in docs/mac-smoke.md §B for the Mac session (behind mac-toolbar feature)
Mac checklist: docs/mac-smoke.md. All 1039 JS + Rust tests green; nothing pushed.

## Sequencing
1. **D. Independent Settings window** (here) — highest value, well-understood.
2. **E. Keyboard shortcuts** (here).
3. **F. Right-click targeting + context menus** (here).
4. **C. Inactive-window subtlety** (here: CSS + focus events; Mac: native polish).
5. **B. Native NSToolbar** (Mac spike) — author here, verify on Mac.
6. **A. Proxy icon + filename** (Mac) — author here, verify on Mac.

Each item = its own commit(s), green gate before moving on (`npm run build` +
`npx tsc --noEmit` + vitest; for Rust `cargo check`).

---

## D. Independent Settings window (cross-platform)
Mirror the security window exactly.
- New `settings.html` (Vite entry — add to `vite.config.ts` input) + `src/settings.tsx`
  (mount a `SettingsWindow` component reusing `SettingsModal`'s body).
- New `src/lib/settingsWindow.ts` mirroring `securityWindow.ts`: `WebviewWindow`
  label `settings`, `settings:ready`/`settings:init` handshake (init pushes any
  state the panel needs; most prefs are localStorage so the child reads them
  directly).
- Prefs already write-through localStorage + dispatch `eigendeck:pref-changed`
  (`preferences.ts`), and `usePreference` listens — so the MAIN window reacts to
  changes made in the settings window automatically. Cross-window note: localStorage
  is per-webview in Tauri; if the settings window and main window DON'T share
  localStorage, the child must emit a Tauri event the main listens for to re-read.
  VERIFY this at runtime (e2e or manual) — if separate, add a `settings:changed`
  event → main re-applies. (This is the one real unknown in D.)
- `App.tsx`: replace modal open (`setSettingsOpen`) with `openSettingsWindow()`.
  Menu "Settings…" (Cmd+,) → open the window. Remove the `<SettingsModal>` mounts
  (or keep the component, render it inside settings.tsx).
- Fallback: works on all platforms (it's a webview window like security).

## E. Keyboard shortcuts (cross-platform)
- Audit menu accelerators in `lib.rs` + frontend keydown handlers; fill the gaps
  into a coherent, documented set. Candidates: New Slide, New Build/duplicate,
  Present (Cmd+Shift+Return?), next/prev slide, delete/duplicate element, group,
  zoom to fit, toggle inspector. Use `CmdOrCtrl`.
- Single source of truth: keep menu items authoritative (they show the shortcut in
  the menu); frontend handlers for editor-only actions not in the menu.
- Document in the manual (`docs/manual/`) + a keyboard-shortcuts reference.

## F. Right-click targeting + context menus (cross-platform)
- On `contextmenu` over a slide (sidebar) or canvas element: highlight the
  right-clicked item WITHOUT changing the actual selection (mac-assed rule), show a
  context menu, restore the highlight on dismiss.
- Implement a `.context-target` highlight class + a small context-menu component (or
  Tauri native menu popup). Actions: duplicate, delete, z-order, etc.
- Reuse existing store actions; no new behavior, just the interaction affordance.

## C. Inactive-window subtlety (cross-platform + Mac polish)
- Tauri `getCurrentWindow().onFocusChanged(({payload}) => toggle body class
  'window-inactive')`. CSS desaturates/dims chrome (toolbar, inspector, sidebar
  headers) subtly when inactive — per mac-assed "subdued, farther away."
- Native AppKit already de-emphasizes native controls automatically; this covers the
  webview content. Applies to main + security + settings windows.

## B. Native NSToolbar (macOS — SPIKE, author here / verify on Mac)
- Add `NSToolbar` (+ delegate protocol) features to `objc2-app-kit` in Cargo.toml.
- New `src-tauri/src/mac_toolbar.rs` (`#[cfg(target_os="macos")]`):
  - `define_class!` an `NSToolbarDelegate` providing allowed/default item
    identifiers (add-slide, add-build, present, …) and building `NSToolbarItem`s with
    SF Symbol images + a target/action selector.
  - The action emits a Tauri event `toolbar:action` `{id}` to the main window.
  - On setup: get `NSWindow` (as in lib.rs), `setToolbar:`, `setToolbarStyle:` =
    `.unified` (native titlebar material), keep title centered.
- Frontend: listen for `toolbar:action` → dispatch the SAME handlers the HTML
  +Slide/+Build buttons use. Hide those HTML buttons on macOS
  (`platform()==='macos'`), keep +Title/+Body in HTML.
- Fallback: non-macOS keeps the full HTML toolbar.
- Mac verification: toolbar renders with native material; each item click triggers
  the right action; title centered; window still resizes/behaves.

## A. Proxy icon + filename (macOS — author here / verify on Mac)
- In the macOS window-setup path: `setRepresentedURL:` = `file://projectPath`,
  `setTitle:` = filename, `setDocumentEdited:` = dirty flag. Cmd-click/drag the
  proxy icon then works natively (Finder reveal, drag-to-share).
- A tiny Tauri command `set_window_document(path, dirty)` invoked from the frontend
  whenever projectPath or the dirty flag changes (open/save/edit). no-op off-macOS.
- Keep the centered title (Tauri default titleBarStyle).

## Open questions to resolve during implementation
- **D:** does the settings WebviewWindow share localStorage with main? If not, add a
  `settings:changed` event bridge. (Resolve first thing in D.)
- **B:** does `setToolbarStyle(.unified)` compose with Tauri's titleBarStyle /
  decorations config? May need `titleBarStyle: Transparent` or `Overlay` in
  `tauri.conf.json` for the toolbar to share the titlebar. Mac-verify.
