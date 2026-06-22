---
name: release
description: Cut a new Eigendeck release (CalVer YY.M.D). Use when the user says to cut/tag/ship a release, bump the version, or "do a release". Covers refreshing mathjax-fonts, updating the open-source/font credits, bumping the version everywhere, building/testing, tagging to trigger the GitHub build, and verifying the draft.
---

# Cut an Eigendeck release

Releases are **CalVer YY.M.D** (e.g. `26.6.23`). Pushing a `v*` tag triggers
`.github/workflows/build.yml` ("Build and Release") → per-arch macOS + Linux +
Windows builds → a **draft** GitHub release you then publish.

## Pre-flight — BEFORE tagging

### 1. Refresh fonts to the latest mathjax-fonts (every release)
Ship the current font builds:
```bash
cd /work/mathjax-fonts && git pull --ff-only      # note the new SHA
```
- Bump `MATHJAX_FONTS_COMMIT` in `scripts/setup-fonts.mjs` to that SHA.
- `npm run setup` (copies the prebuilt `-nosre` bundles into `public/mathjax/`).
- See the **update-fonts** skill for details.

### 2. Update the credits (if deps or fonts changed)
The open-source + font list lives in THREE places that must agree:
- `src-tauri/Credits.html` — the macOS About panel (centered, auto-loaded).
- `ABOUT_CREDITS` in `src-tauri/src/lib.rs` — the Windows/Linux About text.
- the **Fonts** line in `CLAUDE.md`.

All bundled fonts are **SIL OFL 1.1**; the font set is `src/lib/fontRegistry.mjs`
(16 families). Keep the credit names matching the picker labels.

### 3. Bump the version everywhere
Same YY.M.D (today's date) in ALL of:
`src-tauri/tauri.conf.json`, `package.json`, `package-lock.json` (2 occurrences),
`src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` (the `name = "eigendeck"`
package). `grep -rn "<old-version>"` to be sure none are missed.

### 4. Verify green
`npm run build` · `npx vitest run` · `cd src-tauri && cargo check && cargo clippy -- -D warnings`.

> ⚠️ **`#[cfg(target_os="macos")]` code is NOT compiled by Linux `cargo check`.**
> Mac-only type/safety errors slip through (it bit us 3×: `changeCount` cast,
> `declareTypes_owner` unsafe, library validation). If you touched Rust under a
> macOS cfg, build on a Mac before tagging.

## Tag + build
```bash
git -c safe.directory=/work tag vYY.M.D
git -c safe.directory=/work push origin vYY.M.D    # triggers Build and Release
gh run watch <run-id> --exit-status                # ~10–15 min
```
- macOS DMG packaging (`bundle_dmg.sh`/`hdiutil`) flakes intermittently — the
  workflow **retries the tauri-action step up to 3×**, so a single hiccup
  self-heals.
- All four jobs must go green: macOS-ARM64, macOS-x64, Linux-x64, Windows-x64.

## Verify the draft, then publish
```bash
gh release view vYY.M.D --json assets -q '.assets[].name'
```
Expect: both Mac DMGs (`_aarch64.dmg` + `_x64.dmg`) + two `.app.tar.gz`, Linux
(`.deb` / `.AppImage` / `.rpm`), Windows (`-setup.exe` / `.msi`). Review the
draft on GitHub and **Publish**.

## Gotchas
- **Re-tagging a version:** delete the old draft + tag first
  (`gh release delete vX.Y.Z --cleanup-tag --yes`), then re-tag at the new commit.
- **"App is damaged" on a downloaded/AirDropped build:** the app is **ad-hoc
  signed** (`signingIdentity: "-"`), not notarized. Recipients must clear
  quarantine **recursively**:
  `xattr -dr com.apple.quarantine /Applications/Eigendeck.app`.
  (Right-click→Open / "Open Anyway" only clears the top level, not nested files —
  that's what made bundled PDFium fail to load until the
  `com.apple.security.cs.disable-library-validation` entitlement landed.) A paid
  Apple Developer account + notarization removes this entirely.
- **Packaged-only features:** Install LLM Tools, the About icon + centered
  credits (`Credits.html`), and pdfium PDF rendering only work in a packaged
  build — exercise them after the build, not in `tauri dev`.
