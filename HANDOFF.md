# Eigendeck — Claude Code Handoff

## Project overview

Build a **Tauri desktop app** that serves as a WYSIWYG slide editor for creating reveal.js presentations with embedded interactive JavaScript demos. The user is a CS professor who gives talks on matrix algorithms, graph algorithms, and HPC. Demos are developed externally (by Claude Code or by hand) as standalone `.html` files and imported into the editor. **The editor does not need a code editor** — it is a slide assembler and presenter, not an IDE.

### Core workflow

1. User creates/opens a project directory
2. User adds slides with text, images, and demo references
3. Claude Code (separately) creates/edits `.html` demo files in the `demos/` folder
4. User clicks reload to see updated demos in the editor
5. User presents directly from the editor (full-screen reveal.js)
6. User exports a self-contained `.html` file for distribution

---

## Project directory structure

```
my-presentation/
  presentation.json       # Slide order, content, layout metadata
  demos/
    bfs-demo.html          # Self-contained HTML demo files
    matrix-multiply.html
    pagerank.html
  images/
    graph1.png
    network-diagram.svg
```

### `presentation.json` schema

```json
{
  "title": "Graph Algorithms for HPC",
  "theme": "white",
  "slides": [
    {
      "id": "uuid-1",
      "type": "text",
      "content": {
        "html": "<h1>Graph Algorithms</h1><p>An overview</p>"
      },
      "notes": "Welcome slide, introduce topic"
    },
    {
      "id": "uuid-2",
      "type": "mixed",
      "content": {
        "html": "<h2>BFS Traversal</h2><p>Click play to see it run.</p>",
        "demo": "demos/bfs-demo.html",
        "demoPosition": { "x": 50, "y": 200, "width": 800, "height": 400 }
      },
      "notes": ""
    },
    {
      "id": "uuid-3",
      "type": "image",
      "content": {
        "html": "<h2>Results</h2>",
        "image": "images/graph1.png",
        "imagePosition": { "x": 100, "y": 150, "width": 700, "height": 450 }
      },
      "notes": ""
    }
  ],
  "config": {
    "transition": "slide",
    "backgroundTransition": "fade",
    "width": 960,
    "height": 700
  }
}
```

This schema should be treated as a starting point. Adjust as needed during implementation, but keep demos as file references (not inline code) and keep the structure flat and simple.

---

## Tech stack

| Component | Choice | Reason |
|-----------|--------|--------|
| App shell | **Tauri v2** | Lightweight, full filesystem access, Rust backend |
| Frontend | **React + Vite** | Fast dev, large ecosystem for drag-and-drop |
| WYSIWYG text | **TipTap** (or Quill) | Rich text editing, extensible, good React integration |
| Presentation engine | **reveal.js** | Industry standard, handles transitions/nav/speaker notes |
| Demo rendering | **iframe with srcdoc or src** | Sandboxed, isolated from editor, same approach works in export |

### Why Tauri over Electron

- Much smaller binary (~5MB vs ~150MB)
- Rust backend for filesystem operations
- Native webview (no bundled Chromium)
- The user prefers lightweight tools

---

## P0 features — MVP

These must all work before anything else is touched.

### 1. Project management

- **New project**: Create a directory with `presentation.json`, `demos/`, `images/`
- **Open project**: Select a directory, validate it has `presentation.json`
- **Save**: Write `presentation.json` to disk (auto-save on changes is nice but not required)
- Use Tauri's filesystem API for all file operations

### 2. Slide CRUD

- **Sidebar**: Thumbnail list of all slides, click to select
- **Add slide**: Button to add blank slide after current
- **Delete slide**: Remove with confirmation
- **Reorder**: Drag-and-drop in the sidebar to reorder
- **Duplicate slide**: Copy current slide

### 3. WYSIWYG text editing

- Click on a slide to enter edit mode
- Rich text: headings (H1, H2, H3), bold, italic, bullet lists, font size
- Uses TipTap or Quill — whatever integrates cleanly
- Text stored as HTML in `presentation.json`
- Toolbar appears when editing (not always visible)

### 4. Demo import from filesystem

- **Add demo to slide**: Button/menu to select a `.html` file from the `demos/` folder
- **Render**: Demo displayed in a sandboxed `<iframe>` on the slide canvas
- **Reload button**: Manual button to reload the iframe (re-read file from disk)
- **Remove demo**: Remove the demo reference from a slide
- Demos are referenced by relative path, never inlined in the JSON
- Each demo `.html` file must be completely self-contained (inline CSS/JS, or CDN references)

### 5. Image support

- Add images via file picker or drag-and-drop onto slide
- Images copied to `images/` folder in the project directory
- Displayed on the slide canvas
- Basic resize (drag corners)

### 6. Present mode

- Full-screen mode that renders all slides as a reveal.js presentation
- Arrow keys, spacebar, escape to exit
- Demo iframes are live and interactive during presentation
- Speaker notes accessible via `S` key (reveal.js built-in)

### 7. Export to self-contained HTML

- One-click export produces a single `.html` file
- reveal.js loaded via CDN `<script>` tags (not inlined — keeps file small)
- Demo HTML files are inlined into the slides as `<iframe srcdoc="...">`
- Images base64-encoded and inlined
- The exported file works by opening it in any browser, no server needed
- Output should be a valid reveal.js presentation that could also be hand-edited

---

## P1 features — after MVP works

### 8. MathJax / LaTeX support

- Inline math (`$...$`) and block math (`$$...$$`) in text editing
- Use reveal.js math plugin with MathJax
- **Important**: Make the MathJax configuration pluggable. The user has a separate project for custom MathJax fonts and will want to swap in a custom build later. Design the integration so the MathJax source/config can be changed without modifying core editor code.

### 9. Static code blocks with syntax highlighting

- Insert a code block element on a slide (not runnable, just display)
- Language-aware syntax highlighting via highlight.js (reveal.js plugin)
- Support at minimum: Julia, Python, C, C++, Rust, Bash

### 10. Theme / style picker

- Select from reveal.js built-in themes: white, black, moon, league, beige, solarized, etc.
- Set global font family
- Custom CSS injection field for advanced styling (e.g., Purdue branding)

### 11. Element drag and resize

- Drag text blocks, images, and demo iframes to reposition on the slide
- Resize handles on elements
- Optional snap-to-grid

### 12. Speaker notes

- Per-slide notes pane in the editor (collapsible panel below the slide)
- Exported into reveal.js speaker notes
- Accessible via `S` key during presentation

### 13. Undo / redo

- Ctrl+Z / Ctrl+Y (Cmd on Mac)
- History stack of at least 50 operations

---

## P2 features — future

- Fragment / build animations (elements appear on click)
- Slide transition configuration (per-slide or global)
- Import existing reveal.js HTML back into the editor
- PDF export
- Vertical (nested) slides for 2D navigation

---

## Demo file contract

Each demo in `demos/` must be a **self-contained HTML file** that works when opened directly in a browser. This is the contract between Claude Code and the editor.

Example demo file (`demos/bfs-demo.html`):

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; font-family: sans-serif; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="canvas" width="800" height="400"></canvas>
  <button id="step">Step</button>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    // ... BFS visualization code ...
    document.getElementById('step').addEventListener('click', () => {
      // advance BFS one step
    });
  </script>
</body>
</html>
```

**Rules for demo files:**
- Must work standalone in a browser (no build step)
- All CSS/JS inline or loaded from CDN
- No references to files outside the demo itself (except CDN)
- Should handle being embedded in an iframe (no `target="_top"` links)
- Should be responsive to container size where possible

**Claude Code development loop:**
1. Claude Code creates/edits `demos/some-demo.html`
2. Claude Code can test by opening the file in a browser
3. User clicks "reload" in the editor to see changes on the slide
4. Iterate until satisfied

---

## Architecture notes

### Editor layout

```
+------------------------------------------+
| Toolbar: [Save] [Present] [Export] [Theme]|
+--------+---------------------------------+
|        |                                 |
| Slide  |     Slide canvas                |
| thumb- |     (WYSIWYG editing area)      |
| nails  |                                 |
|        |     +-------------------+       |
| [1] *  |     | Demo iframe      |       |
| [2]    |     | [Reload]          |       |
| [3]    |     +-------------------+       |
| [4]    |                                 |
|        +---------------------------------+
| [+Add] | Speaker notes (collapsible)     |
+--------+---------------------------------+
```

### Iframe sandboxing

Demo iframes should use:
```html
<iframe
  src="tauri://localhost/demos/bfs-demo.html"
  sandbox="allow-scripts allow-same-origin"
  style="border: none; width: 100%; height: 100%;"
></iframe>
```

In export mode, switch to `srcdoc` with the demo HTML inlined.

For the dev/editor context, load from the filesystem via Tauri's asset protocol. The reload button simply sets `src` to the same URL with a cache-busting query param.

### State management

Keep it simple. A single React context or Zustand store holding:
- `slides[]` — the slide array from `presentation.json`
- `currentSlideIndex` — which slide is selected
- `isPresenting` — toggle for present mode
- `isDirty` — unsaved changes flag

No need for complex state management. This is a single-user tool.

### Export strategy

```javascript
function exportPresentation(project) {
  // 1. Build reveal.js HTML skeleton with CDN links
  // 2. For each slide:
  //    - If text: insert HTML into <section>
  //    - If demo: read demos/foo.html from disk,
  //              insert as <iframe srcdoc="...escaped html...">
  //    - If image: read file, base64 encode,
  //              insert as <img src="data:image/png;base64,...">
  //    - Add speaker notes as <aside class="notes">
  // 3. Write single .html file
}
```

---

## What NOT to build

- **No in-editor code editor** — demos are edited externally
- **No slide templates** — single user, manual layout is fine
- **No collaboration features** — single user
- **No cloud storage** — everything is local files
- **No hot-reload for demos** — manual reload button is sufficient
- **No build step for demos** — they must be self-contained HTML

---

## Build & CI/CD

### Local development (Linux)

```bash
# Prerequisites
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Node.js 20+ via nvm or system package

# Create project
npm create tauri-app@latest eigendeck -- --template react-ts
cd eigendeck
npm install
npm install reveal.js @tiptap/react @tiptap/starter-kit @tiptap/extension-heading

# Dev mode
npm run tauri dev

# Build Linux release
npm run tauri build
```

### GitHub Actions CI/CD — build for all platforms

Tauri cannot cross-compile (it depends on native system webviews), so we use GitHub Actions runners for each platform. Create `.github/workflows/build.yml`:

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-tauri:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target aarch64-apple-darwin'
            label: 'macOS-ARM64'
          - platform: 'macos-latest'
            args: '--target x86_64-apple-darwin'
            label: 'macOS-x64'
          - platform: 'ubuntu-22.04'
            args: ''
            label: 'Linux-x64'

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: 'npm'

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Cache Rust
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: Install frontend dependencies
        run: npm ci

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Eigendeck ${{ github.ref_name }}'
          releaseBody: 'See the assets for download links.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

### Release workflow

1. Develop and test locally on Linux with `npm run tauri dev`
2. When ready to release: `git tag v0.1.0 && git push --tags`
3. GitHub Actions builds for Linux x64, macOS x64, macOS ARM64
4. Artifacts appear as a draft GitHub Release
5. Review and publish the release

### Repository structure

```
eigendeck/
  .github/
    workflows/
      build.yml              # CI/CD for multi-platform builds
  src/                       # React frontend
    components/
      SlideEditor.tsx         # Main editor canvas
      SlideSidebar.tsx        # Thumbnail sidebar
      Toolbar.tsx             # Top toolbar
      DemoFrame.tsx           # iframe wrapper for demos
      PresentMode.tsx         # Full-screen reveal.js presenter
    App.tsx
    main.tsx
  src-tauri/                  # Tauri/Rust backend
    src/
      main.rs                # Filesystem commands, project I/O
    tauri.conf.json
    Cargo.toml
  public/
  package.json
  vite.config.ts
```

---

## Getting started

1. `npm create tauri-app@latest eigendeck -- --template react-ts`
2. Set up Vite + React + TypeScript
3. Install dependencies: `reveal.js`, `@tiptap/react`, `@tiptap/starter-kit`, a drag-and-drop library
4. Create `.github/workflows/build.yml` from the template above
5. Start with the project open/save flow and slide CRUD
6. Get present mode working early (rendering slides with reveal.js)
7. Then add demo iframe loading
8. Then WYSIWYG text editing
9. Then export
