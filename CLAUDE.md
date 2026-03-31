# Eigendeck — Claude Code Project Guide

## What is this?

Eigendeck is a Tauri v2 desktop app for building reveal.js presentations with embedded interactive HTML demos. The user is a CS professor who gives talks on matrix algorithms, graph algorithms, and HPC.

## Tech stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri v2 (Rust)
- **Rich text**: TipTap
- **Presentation engine**: reveal.js v5
- **State management**: Zustand
- **Fonts**: PT Sans for slides, system font for UI

## Build commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript check + Vite build (frontend only)
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

## Conventions

- Demos are standalone `.html` files in `demos/` — never inline code in the JSON
- Use `presentation.json` as the single source of truth for slide data
- Keep the Rust backend minimal — most logic lives in the frontend
- No unnecessary abstractions — this is a single-user tool
