# Eigendeck Development Setup

Step-by-step instructions to set up a development environment for Eigendeck.
These instructions assume a fresh machine with no development tools installed.

## Prerequisites

Eigendeck is a [Tauri v2](https://v2.tauri.app/) app with a React + TypeScript frontend
and a Rust backend. You need: Node.js, Rust, and platform-specific system libraries.

---

## macOS (Apple Silicon or Intel)

### 1. Install Xcode Command Line Tools

```bash
xcode-select --install
```

### 2. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

Verify: `rustc --version` should print 1.75+.

### 3. Install Node.js (via nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc   # or ~/.bashrc
nvm install --lts
```

Verify: `node --version` should print v20+ and `npm --version` should print 10+.

### 4. Clone and install

```bash
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
```

### 5. Run in development mode

```bash
npm run tauri dev
```

This starts the Vite dev server and opens the Tauri window with hot-reload.

### 6. Build a release binary

```bash
npm run tauri build
```

Output will be in `src-tauri/target/release/bundle/`.

---

## Linux (Ubuntu/Debian)

### 1. Install system dependencies

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 2. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### 3. Install Node.js (via nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
```

### 4. Clone and install

```bash
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
```

### 5. Run in development mode

```bash
npm run tauri dev
```

### 6. Build a release binary

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`.

---

## Windows

### 1. Install Visual Studio Build Tools

Download and install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
Select "Desktop development with C++" workload.

### 2. Install Rust

Download and run `rustup-init.exe` from https://rustup.rs/.

### 3. Install Node.js

Download the LTS installer from https://nodejs.org/.

### 4. Install WebView2

Windows 10/11 usually has WebView2 pre-installed. If not, download from
https://developer.microsoft.com/en-us/microsoft-edge/webview2/.

### 5. Clone and install

```powershell
git clone git@github.com:dgleich/eigendeck.git
cd eigendeck
npm install
```

### 6. Run and build

```powershell
npm run tauri dev
npm run tauri build
```

---

## Common commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server only (frontend) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run tauri dev` | Full Tauri dev mode (frontend + native window) |
| `npm run tauri build` | Build release binary for current platform |

## Project structure

```
eigendeck/
  .github/workflows/    # CI and release workflows
  example-demos/example-project/      # Sample presentation with BFS demo
  public/fonts/         # PT Sans font files (bundled)
  src/                  # React frontend
    components/         # React components
    store/              # Zustand store + file operations
    types/              # TypeScript types
  src-tauri/            # Rust backend
    src/                # Rust source code
    capabilities/       # Tauri permission configuration
    Cargo.toml          # Rust dependencies
    tauri.conf.json     # Tauri app configuration
  package.json          # Node.js dependencies
  vite.config.ts        # Vite configuration
```

## Fonts

- **Slide content**: PT Sans (bundled in `public/fonts/`)
- **UI elements**: System default font (system-ui)

## Troubleshooting

### Linux: `libwebkit2gtk-4.1` not found
Make sure you installed the exact package names listed above. On older Ubuntu
versions, the package may be `libwebkit2gtk-4.0-dev` instead.

### macOS: Rust target errors
For Apple Silicon Macs, ensure you have the ARM target:
```bash
rustup target add aarch64-apple-darwin
```

### Build errors after pulling
```bash
npm ci                # Reinstall exact locked dependencies
cargo clean           # Clear Rust build cache (in src-tauri/)
```
