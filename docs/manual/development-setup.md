# Development setup

This page is for people who want to build Eigendeck from source or contribute to
it. If you just want to *use* Eigendeck, grab a build from the
[downloads page](https://github.com/dgleich/eigendeck/releases) instead.

Eigendeck is a [Tauri v2](https://v2.tauri.app/) app: a React + TypeScript
frontend and a Rust backend. To build it you need **Node.js 20+**, **Rust 1.85+**,
and a few platform-specific system libraries.

## macOS

```bash
# 1. Xcode command line tools
xcode-select --install

# 2. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"          # rustc --version → 1.85+

# 3. Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install --lts                  # node --version → v20+

# 4. Clone, install, run
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
npm run setup                      # copies the MathJax bundle (one-time, required)
npm run tauri dev                  # dev window with hot-reload (Cmd+Q to quit)
```

For Apple Silicon, make sure the ARM target is present:
`rustup target add aarch64-apple-darwin`.

## Linux (Ubuntu/Debian)

```bash
# 1. System libraries
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libssl-dev \
  libwebkit2gtk-4.1-dev libappindicator3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf

# 2. Rust + 3. Node.js — same rustup / nvm steps as macOS above.

# 4. Clone, install, run
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
npm run setup
npm run tauri dev
```

If `libwebkit2gtk-4.1-dev` isn't found, older Ubuntu releases may need
`libwebkit2gtk-4.0-dev` instead.

## Windows

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
2. Install Rust from [rustup.rs](https://rustup.rs/) (`rustup-init.exe`).
3. Install the Node.js LTS from [nodejs.org](https://nodejs.org/).
4. WebView2 is usually pre-installed on Windows 10/11; if not, grab it from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

```powershell
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
npm run setup
npm run tauri dev
```

## Common commands

| Command | What it does |
|---------|--------------|
| `npm run setup` | Copy the MathJax bundle into `public/mathjax/` (one-time after clone) |
| `npm run dev` | Vite dev server only (frontend, no native window) |
| `npm run build` | TypeScript check + Vite production build |
| `npm test` | Vitest unit tests |
| `npm run tauri dev` | Full Tauri dev mode (frontend + native window, hot-reload) |
| `npm run tauri build` | Release binary for the current platform |

Release output lands in `src-tauri/target/release/bundle/` (`.app`/`.dmg` on
macOS, `.deb`/`.AppImage` on Linux).

To check the Rust side: `cd src-tauri && cargo check && cargo clippy -- -D warnings`.

## Fonts and MathJax

Slide text uses bundled fonts in `public/fonts/`; the UI uses the system font.
Math is rendered by MathJax with a custom math pack per text font. The packs are
built from the sibling **dgleich/mathjax-fonts** repo — you only need to rebuild
them when changing a math font, and `npm run setup` copies the result into
`public/mathjax/`. There is no auto-build.

## Troubleshooting

**Build errors after pulling.** Reinstall exact locked deps and clear the Rust
cache: `npm ci`, then `cd src-tauri && cargo clean`.

**macOS: Rust target errors.** `rustup target add aarch64-apple-darwin` (Apple
Silicon) or `x86_64-apple-darwin` (Intel).

**Port 1420 already in use.** The Vite dev server uses it — find and stop the
stray process (`lsof -i :1420`).

**Blank window / WebView errors.** Tauri uses the system WebView, so keep the OS
up to date.
