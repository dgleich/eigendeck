# Eigendeck Changelog

## Development Log (March 31 – April 2, 2026)

### Day 1 — Foundation (March 31)

**Initial scaffold and MVP** (commits 1–10)
- Created Tauri v2 + React + TypeScript app from scratch
- Installed Rust toolchain and Tauri system dependencies in Linux container
- Built slide editor with TipTap WYSIWYG text editing
- Slide sidebar with drag-and-drop reorder
- Present mode using reveal.js
- Export to self-contained HTML
- GitHub Actions CI (TypeScript check, Vite build, cargo check, clippy)
- Release workflow for Linux, macOS (ARM64 + x64), Windows
- PT Sans font bundled for slides, system font for UI
- Keyboard shortcuts: Cmd+S, F5, Escape

**Testing and docs** (commits 11–15)
- Vitest test suite with 18 tests (store, file ops, types)
- Full Tauri build verified (15MB binary, 5.7MB .deb)
- SETUP.md for environment setup (macOS, Linux, Windows)
- MAC-BUILD.md for building from shared Colima directory
- CLAUDE.md project guide

**Feature additions** (commits 16–30)
- Speaker notes panel with timer
- Image support (file picker, clipboard paste, drag positioning)
- Theme picker (11 reveal.js themes)
- Editable presentation title
- Demo iframe embedding with reload
- Slide layouts: default, centered, two-column
- Slide numbers in footer
- Author/venue footer text
- Font size picker, PT Sans Narrow, uppercase button
- 14-color text color palette
- Native macOS menu bar (File, Edit, View, Window)
- Unsaved changes warning
- Text boxes (positioned anywhere)
- Annotation arrows (SVG with draggable endpoints)
- Undo/redo with zundo (100-step history, batched drags)
- Resizable sidebar with drag handle

### Day 2 — Architecture (April 1)

**Reveal.js removal** (commits 31–35)
- Replaced reveal.js with custom presenter (identical to editor rendering)
- Standalone HTML export without any dependencies
- CSS bundle: 63KB → 16KB (74% smaller)
- JS bundle: 768KB → 630KB (18% smaller)
- No more WYSIWYG mismatches between editor and presenter

**Unified elements array** (commits 36–40)
- Refactored data model: all content is now positioned elements
- Single `elements[]` array per slide (array order = z-order)
- Z-order controls: move to top/up/down/bottom
- Delete key deletes selected element
- Properties panel (Cmd+I) with contextual properties
- -1007 net lines removed

**Text presets** (commits 41–43)
- Removed TipTap entirely — all text uses contentEditable
- 5 text presets: Title, Body, Text Box, Annotation, Footnote
- JS bundle: 630KB → 247KB (61% smaller!)
- LLM-EDITING.md guide for programmatic presentation editing

**Auto-save and history** (commits 44–46)
- Debounced auto-save (3 seconds after last change)
- Save on window blur, before present mode
- Timestamped backup files (keeps last 20)
- Undo history cleared on file load

### Day 2–3 — MathJax and Polish (April 1–2)

**MathJax integration** (commits 47–67)
- Custom PT Sans math font via MathJax 4
- `$...$` inline math, `$$...$$` display math
- Extensive debugging of Tauri WebKit blob Worker issues
- SRE (Speech Rule Engine) causes blob: Worker that Tauri blocks
- Solution: nosre MathJax bundle + Worker stub + brace wrapping
- Debug console (Cmd+Shift+D) for JS error visibility
- WebKit devtools auto-open in dev mode
- Separate display/edit divs so MathJax doesn't corrupt editing
- `$$` lines don't wrap while editing (WYSIWYG consistency)
- Compact placeholder while MathJax renders

**Slide groups** (commits 68–72)
- Groups share slide numbers
- Child slides indented and smaller in sidebar
- "+ Build" button duplicates into same group
- Moving parent moves entire group
- Foundation for linked object animations

**Bug fixes throughout**
- Drag-and-drop: rewrote with pointer events for WebKit
- Demo iframes: transparent overlay for drag, double-click to interact
- Arrow dragging over demos
- Dark theme CSS bleed fixed
- Image rendering consistency between editor and presenter
- Text format toolbar portaled to body (not scaled with canvas)
- Selection highlighting during drag

### Architecture Summary

```
Technology          Before          After
─────────────────────────────────────────────
Rich text editor    TipTap          contentEditable
Presentation engine reveal.js       Custom renderer
Slide data model    Separate fields Unified elements[]
CSS bundle          63 KB           18 KB
JS bundle           768 KB          258 KB
Test count          18              18
Total commits       81              —
```

### Current Feature List

- 5 text element presets with inline formatting
- Images (file picker + Cmd+V paste)
- Annotation arrows (SVG, draggable)
- Interactive HTML demos (iframe, double-click to interact)
- LaTeX math ($...$ and $$...$$) via MathJax SVG
- Slide groups for builds/animations
- Custom presenter (WYSIWYG with editor)
- Standalone HTML export
- Properties panel (Cmd+I)
- Z-order controls
- Undo/redo (Cmd+Z, 100 steps)
- Auto-save with backup history
- Native macOS menu bar
- Resizable sidebar
- Speaker notes with timer
- Author/venue footer
- Debug console (Cmd+Shift+D)
- 3 example presentations
- LLM editing guide
- CI/CD for Linux, macOS, Windows
