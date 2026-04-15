# Eigendeck

*The characteristic presentation tool.*

A lightweight Tauri desktop app for building reveal.js presentations with embedded interactive JavaScript demos.

Designed for academics and developers who want PowerPoint-like slide assembly but with native JS demos (algorithm visualizations, interactive charts, simulations) that run live during presentation.

## Architecture

- **Editor**: WYSIWYG slide assembly tool (React + TipTap + Tauri)
- **Demos**: Standalone `.html` files in a `demos/` folder, developed externally (e.g., via Claude Code)
- **Presentation**: Full-screen reveal.js with live interactive demos
- **Export**: Self-contained `.html` file that works in any browser

## Development

### Prerequisites

**Linux (Ubuntu 22.04+):**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

**macOS:**
```bash
xcode-select --install
```

**All platforms:**
```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js 20+ (via nvm or system package)
```

### Getting started

```bash
npm install
npm run tauri dev
```

### Build for release

```bash
npm run tauri build
```

### CI/CD

Push a git tag to trigger multi-platform builds via GitHub Actions:

```bash
git tag v0.1.0
git push --tags
```

This builds for Linux x64, macOS x64, macOS ARM64, and Windows x64, then creates a draft GitHub Release.

See [SETUP.md](SETUP.md) for detailed environment setup instructions.

## Project format

Presentations are stored as a directory:

```
my-presentation/
  presentation.json       # Slide content and metadata
  demos/
    bfs-demo.html          # Self-contained interactive demos
    matrix-multiply.html
  images/
    diagram.png
```

See `example-demos/example-project/` for a working example.

## Demo development workflow

1. Create a new `.html` file in `demos/`
2. Develop it standalone — it should work when opened directly in a browser
3. Use Claude Code or any editor to iterate on the demo
4. In the presentation editor, add the demo to a slide and click Reload to see changes
5. On export, demos are inlined into the final `.html` file

## License

MIT
