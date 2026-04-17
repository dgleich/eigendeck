# Eigendeck — Claude Code Project Guide

## What is this?

Eigendeck is a Tauri v2 desktop app for building presentations with embedded interactive HTML demos and LaTeX math. The user is a CS professor (David Gleich, Purdue) who gives talks on matrix algorithms, graph algorithms, and HPC.

## Tech stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri v2 (Rust)
- **Text editing**: Native contentEditable (no TipTap)
- **Math**: MathJax 4 with custom PT Sans math font (SVG output)
- **Presentation**: Custom renderer (no reveal.js)
- **State**: Zustand + zundo (undo/redo)
- **Testing**: Vitest with jsdom
- **Fonts**: PT Sans, PT Sans Narrow (bundled TTF)

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

Only needed when changing the math font or updating MathJax:

```bash
cd mathjax-ptsans-bundle
npm install          # installs @mathjax/src locally
npm run build        # rebuilds the bundle
cd ..
npm run setup        # copies to public/mathjax/
```

## Rust check

```bash
cd src-tauri && cargo check && cargo clippy -- -D warnings
```

## Project structure

- `src/` — React frontend
  - `components/` — SlideEditor, SlideElementRenderer, PresentMode, SlideSidebar, etc.
  - `store/` — Zustand store (presentation.ts), file ops, auto-save
  - `types/` — Presentation/Slide/Element TypeScript types
  - `lib/` — MathJax integration (mathjax.ts)
- `src-tauri/` — Rust backend, Tauri config, native menu
- `public/fonts/` — PT Sans font files
- `public/mathjax/` — MathJax bundle (gitignored, copy from mathjax-ptsans-bundle/)
- `mathjax-ptsans-bundle/` — MathJax source + build configs
- `examples/` — 3 example presentations
- `.github/workflows/` — CI and release workflows

## Key files

- `src/components/SlideElementRenderer.tsx` — renders ALL element types (text, image, arrow, demo)
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
Element types: `text` (5 presets), `image`, `arrow`, `demo`.
Slides can have `groupId` for slide groups (shared numbering, group move).

See SPEC.md for full schema and LLM-EDITING.md for programmatic editing guide.

## Hooks

PostToolUse hook on Write|Edit reminds to update LLM-EDITING.md when src/types/presentation.ts changes. (In .claude/settings.local.json)
