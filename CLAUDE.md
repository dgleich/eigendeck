# Eigendeck — Claude Code Project Guide

## What is this?

Eigendeck is a Tauri v2 desktop app for building reveal.js presentations with embedded interactive HTML demos. The user is a CS professor who gives talks on matrix algorithms, graph algorithms, and HPC.

## Tech stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri v2 (Rust)
- **Rich text**: TipTap
- **Presentation engine**: reveal.js v5 (with Notes plugin)
- **State management**: Zustand
- **Testing**: Vitest with jsdom + React Testing Library
- **Fonts**: PT Sans for slides, system font for UI

## Build commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript check + Vite build (frontend only)
npm test             # Run Vitest unit tests
npm run tauri dev    # Full dev mode with hot-reload
npm run tauri build  # Release build for current platform
```

## Rust check (after changing src-tauri/)

```bash
cd src-tauri && cargo check && cargo clippy -- -D warnings
```

## Project structure

- `src/` — React frontend components, store, types
- `src-tauri/` — Rust backend, Tauri config, capabilities
- `public/fonts/` — Bundled PT Sans font files
- `example-project/` — Sample presentation with BFS demo
- `.github/workflows/` — CI and release workflows

## Key files

- `src/store/presentation.ts` — Zustand store (slides, current index, dirty flag)
- `src/store/fileOps.ts` — File operations (open, save, export)
- `src/types/presentation.ts` — TypeScript types for presentation.json schema
- `src-tauri/capabilities/default.json` — Tauri permissions for fs/dialog

## WYSIWYG contract

All three rendering contexts (editor, present mode, export) must use identical styles:
- Font: PT Sans, body 42px, H1 72px, H2 56px, H3 44px
- Left-aligned, no text-transform, no text-shadow
- Slide dimensions: 960x700px
- Editor canvas is CSS-scaled to fit viewport; thumbnails use same approach

These styles are defined in three places that must stay in sync:
1. `src/App.css` — `.slide-content-styles` and `.editor-content .tiptap` selectors
2. `src/components/PresentMode.tsx` — `SLIDE_OVERRIDE_CSS` constant
3. `src/store/fileOps.ts` — inline `<style>` in export HTML

## Conventions

- Demos are standalone `.html` files in `demos/` — never inline code in the JSON
- Use `presentation.json` as the single source of truth for slide data
- Keep the Rust backend minimal — most logic lives in the frontend
- No unnecessary abstractions — this is a single-user tool
- Use `convertFileSrc` from `@tauri-apps/api/core` to load local files in webview

## Current feature status

### Working (P0):
- Project create/open/save
- Slide CRUD (add, delete, duplicate, drag-reorder)
- WYSIWYG text editing (H1-H3, bold, italic, lists)
- Demo iframe embedding with reload
- Image support (add, display, remove)
- Present mode with reveal.js
- Speaker notes (editor panel + reveal.js S key for dual screen)
- Export to self-contained HTML
- Theme picker (reveal.js themes)
- Keyboard shortcuts (Cmd/Ctrl+S, F5, Escape)
- Unsaved changes warning

### Not yet implemented:
- Element drag and resize on canvas
- MathJax / LaTeX support
- Code blocks with syntax highlighting
- Undo/redo
- Custom CSS injection
