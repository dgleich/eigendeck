# Building Eigendeck on macOS

Instructions for a Claude Code instance running on a Mac to build and test Eigendeck.
A Linux Colima container does the main development in this same directory.

## Shared directory

This directory is shared between the Mac and a Linux Colima container via virtiofs.
The source files are the same on both sides. **You do not need to clone anything.**

### Platform-specific files

`node_modules/` contains platform-native binaries. Running `npm install` on Mac
overwrites the Linux versions and vice versa. This is fine — whichever side needs
to build just runs `npm install` again. The `src-tauri/target/` directory handles
multiple platforms automatically (Cargo uses separate target directories).

## One-time setup

### 1. Install prerequisites

```bash
# Xcode command line tools (if not already installed)
xcode-select --install

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Install Node.js via nvm (if not already installed)
# Check first: node --version (need v20+)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install --lts
```

### 2. Install dependencies

```bash
cd /path/to/this/directory   # the same dir as this file
npm install
```

## Building and running

```bash
# Development mode (hot-reload, opens a native window)
npm run tauri dev

# Production build (creates .app bundle and .dmg)
npm run tauri build
```

The app window should open automatically in dev mode.

## IMPORTANT: Do not overwrite source files

The Linux container handles code changes. On the Mac, you should:

### DO:
- Run `npm install` (this is expected and safe)
- Run `npm run tauri dev` to test visually
- Report bugs or visual issues back to the user
- Test file dialogs, present mode, export
- Build release binaries with `npm run tauri build`
- Push to GitHub with `git push -u origin main` if the user asks

### DO NOT:
- Edit source files in `src/` or `src-tauri/src/` (the Linux container owns these)
- Run `npm update` or change `package-lock.json`
- Commit changes (unless explicitly asked by the user)

### If you need to fix something to get it building:
1. Note what's broken and tell the user — they'll fix it in the Linux container
2. If it's urgent, make the fix but do NOT commit or push. Tell the user what you changed.

## Smoke test checklist

After building, verify these work:

1. **App launches** — `npm run tauri dev` opens a window
2. **New project** — Click New, select an empty directory, verify it creates `presentation.json`, `demos/`, `images/`
3. **Open project** — Click Open, select `example-project/` from the repo root
4. **Edit slide** — Click on the slide canvas, type text, use H1/H2/Bold/Italic buttons
5. **Add slide** — Click "+ Add Slide" in sidebar
6. **Reorder slides** — Drag a slide thumbnail in the sidebar
7. **Delete/duplicate** — Hover a thumbnail, use D and X buttons
8. **Present mode** — Click "Present" button or press F5, arrow keys to navigate, Esc to exit
9. **Demo iframe** — Open example-project, slide 2 should show the BFS demo
10. **Demo reload** — Click the Reload button on the demo iframe
11. **Save** — Ctrl+S (or Cmd+S), verify `presentation.json` is updated
12. **Export** — Click Export, save as HTML, open the exported file in a browser
13. **Keyboard shortcuts** — Cmd+S saves, F5 presents, Esc exits present mode

## Troubleshooting

### `npm run tauri dev` fails with missing Rust target
```bash
rustup target add aarch64-apple-darwin   # Apple Silicon
rustup target add x86_64-apple-darwin    # Intel
```

### WebView errors or blank window
Make sure macOS is up to date — Tauri uses the system WebView (Safari/WebKit).

### Port 1420 already in use
```bash
lsof -i :1420   # find what's using it
kill <PID>       # kill it
```

### Cargo build errors
```bash
cd src-tauri && cargo clean && cd ..
npm run tauri dev
```
