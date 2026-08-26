# Eigendeck — Agent & Project Guide

> Canonical guide for any coding agent (Claude Code, Cursor, etc.) working in this
> repo. `CLAUDE.md` points here.

## What is this?

Eigendeck is a Tauri v2 desktop app for building presentations with embedded interactive HTML demos and LaTeX math. The user is a CS professor (David Gleich, Purdue) who gives talks on matrix algorithms, graph algorithms, and HPC.

## Tech stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri v2 (Rust)
- **Text editing**: Native contentEditable (no TipTap)
- **Math**: MathJax 4 with custom math-font packs — one per text font (SVG output)
- **Presentation**: Custom renderer (no reveal.js)
- **State**: Zustand + zundo (undo/redo)
- **Testing**: Vitest with jsdom
- **Fonts** (all SIL OFL 1.1; see `src/lib/fontRegistry.mjs`): **10 font families**, each with a matching MathJax math pack (`FONT_PACKAGES`: PT Sans, Lato, Libertinus, Libertinus Sans, Computer Modern Sans, Noto Sans, Source Sans 3, Source Code Pro, Shantell, Computer Modern Concrete) + monospace **code fonts** with no math (`MONO_FONT_PACKAGES`: Fira Code, IBM Plex Mono, Inconsolata, JetBrains Mono, PT Mono, Computer Modern Typewriter)

## Prerequisites

- **Node.js 20+** (`node -v` to check; install via `brew install node` or nvm)
- **Rust 1.85+** (`rustc --version`; `rustup update stable` to update)

## Build commands

```bash
npm install          # Install dependencies
npm run setup        # Copy MathJax bundle (run once after clone)
npm run build        # TypeScript check + Vite build
npm test             # Run Vitest unit tests
npm run tauri dev    # Full dev mode with hot-reload (occupies terminal, Cmd+Q to quit)
npm run tauri build  # Release build → src-tauri/target/release/bundle/
```

## Rebuilding MathJax font bundle

Only needed when changing the math font or updating MathJax. The math packs are
built from the sibling **dgleich/mathjax-fonts** repo — see the `update-fonts`
skill (or `docs/updating-fonts.md`) for the pull → build-all-nosre → `npm run
setup` flow. There is no auto-build; `npm run setup` only copies the bundles into
`public/mathjax/`.

## Rust check

```bash
cd src-tauri && cargo check && cargo clippy -- -D warnings
```

**Running cargo in the dev container.** The crate *does* compile here: the GTK/WebKit
dev libraries Tauri needs are already installed (`pkg-config --exists webkit2gtk-4.1`
returns true) and `sudo` is passwordless. Two non-obvious things make cargo *look*
broken, and get misread as "GLib/GTK metadata not present":

- **`cargo` is not on `PATH`.** `export PATH="$HOME/.cargo/bin:$PATH"` (reinstall with
  `rustup` if a container reset wiped `~/.cargo`).
- **`/work` is a `noexec` mount**, so build-scripts can't execute there and cargo fails
  with `Permission denied (os error 13) … build-script-build (never executed)`. Point
  the target dir at an exec-capable location: `export CARGO_TARGET_DIR="$HOME/el-target"`.

Storage tests share one global SQLite connection, so run them serially —
`cargo test --lib -- --test-threads=1` (parallel runs race and fail spuriously). If a
fresh container is genuinely missing the native libs: `sudo apt-get install -y
pkg-config build-essential libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev
libjavascriptcoregtk-4.1-dev libsoup-3.0-dev librsvg2-dev`.

## Headless verification (don't defer to a Mac too fast)

A lot that feels "app-only" **can** be checked headlessly in this Linux container:
`vitest` (jsdom, unit + `@testing-library/react` components) → **Playwright/Chromium**
(real HTML→PNG rasterize, `page.pdf()`, WebGL via swiftshader) → the **e2e Tauri
rig** (`eigendeck-e2e` skill: the REAL app in headless WebKitGTK with real `invoke`
+ SQLite, driven via the `window.__eigendeck` seam) → `eigendeck-cli` → `cargo
check`. jsdom can't rasterize (mock `domToDataUrl`); the e2e rig can't drive native
dialogs. **Genuinely Mac-only:** `#[cfg(target_os="macos")]` code (NSToolbar/menu),
the macOS clipboard, and pixel-perfect sign-off in the shipped WebKit. Full matrix
+ how-to: **`docs/headless-verification.md`**.

## Project structure

- `src/` — React frontend
  - `components/` — SlideEditor, SlideElementRenderer, PresentMode, SlideSidebar, etc.
  - `store/` — Zustand store (presentation.ts), file ops, auto-save
  - `types/` — Presentation/Slide/Element TypeScript types
  - `lib/` — MathJax integration (mathjax.ts)
- `src-tauri/` — Rust backend, Tauri config, native menu
- `public/fonts/` — bundled font families (see `fontRegistry.mjs`)
- `public/mathjax/` — MathJax bundle (gitignored, copied by `npm run setup`)
- `examples/` — example presentations
- `docs/` — design/internal docs (SPEC, LLM-EDITING, DEMO_AUTHORING, DEMO_SPEC, …)
- `.github/workflows/` — CI and release workflows

## Key files

- `src/components/SlideElementRenderer.tsx` — renders ALL element types (text, image, arrow, demo, demo-piece, notebook, video, cover)
- `src/store/presentation.ts` — Zustand store with all slide/element actions
- `src/types/presentation.ts` — data model (Slide, SlideElement, TextPreset, etc.)
- `src/lib/mathjax.ts` — MathJax loading, rendering, caching
- `src/components/PresentMode.tsx` — fullscreen presenter
- `src/store/fileOps.ts` — open/save/export
- `src/store/autoSave.ts` — debounced auto-save with backups
- `src-tauri/src/lib.rs` — native menu, devtools

## Critical rules

1. **Never clear root element styles** in `applyMathLineStyles()` — only child elements. Clearing root `lineHeight` overwrites React's managed styles and causes visible shift.

2. **MathJax tex must be wrapped in braces**: `MJ.tex2svgPromise(`{${tex}}`)` — without braces, MathJax only renders the first sub-expression.

3. **Call `MJ.texReset()`** before each `tex2svgPromise` call.

4. **fontCache must be 'none'** — blob cache breaks in Tauri's WebKit.

5. **Blob Worker stub required** — MathJax's BrowserAdaptor creates a Worker via blob: URL that Tauri blocks. The stub in mathjax.ts intercepts this.

6. **contentEditable toggles** — don't use always-contentEditable (breaks dragging). Toggle `contentEditable={editing}` on double-click.

7. **Text format toolbar must be portaled** to `document.body` via `createPortal` — otherwise it's tiny (inside the CSS-scaled canvas).

8. **Demo iframes need a transparent overlay** for dragging — the iframe captures pointer events. Double-click overlay to interact.

## Data model

Every slide has an `elements[]` array. Array order = z-order.
Element types: `text` (5 presets), `image`, `arrow`, `demo`, `demo-piece`, `notebook`, `video` (file or YouTube/Vimeo/PeerTube embed), `cover`, `html` (raw-HTML escape hatch — sandboxed, no script, no network).
Slides can have `groupId` for slide groups (shared numbering, group move).

See `docs/SPEC.md` for full schema and `docs/LLM-EDITING.md` for the programmatic editing guide.

**Changing an element type or property?** Follow `docs/ELEMENT-CHECKLIST.md` — the
"what to touch, how to verify" checklists covering all **7 render/output modes**
(editor, present, present-animation, HTML export, PDF/print, link overlay,
thumbnail). A property added in one mode is silently dropped by the others unless
propagated (the #98/#85 bug class).

## Hooks

PostToolUse hook on Write|Edit reminds to update `docs/LLM-EDITING.md` when src/types/presentation.ts changes. (In .claude/settings.local.json)

## Committing

- One reviewed change is one commit, made before reporting back. Split unrelated fixes
  into separate, **independently-green** commits (each one builds and passes on its own).
- Message: a conventional header `type(scope): imperative summary` (lowercase — `fix`,
  `feat`, `security`, `test`, `docs`, `chore`, `refactor`), then a prose body in full
  sentences saying *what and why*. End with the `Co-Authored-By:` + `Claude-Session:`
  trailer your harness provides.
- **Never put backticks in `git commit -m`** — bash runs them as command substitution and
  silently blanks those words. Use `git commit -F -` with a heredoc, or a message file.
- Run the gates green first: frontend `npx tsc --noEmit` + `npx vitest run`; Rust
  `cargo check` + `cargo clippy -- -D warnings` + `cargo fmt --check` +
  `cargo test --lib -- --test-threads=1` (see **Rust check** above for the container setup).

## Session logs

Arc-level dev history lives in `.claude/logs/` (tracked). When you ship a
meaningful chunk of work, add a `YYYY-MM-DD-<topic>-session.md` entry there — a
short narrative of *what* and *why* (git log has the commit-level detail). This
replaces the old root `CHANGELOG.md`, which was folded into `.claude/logs/` on
2026-07-07.
