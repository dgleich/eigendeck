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
- Bump `MATHJAX_FONTS_COMMIT` in `tools/setup-fonts.mjs` to that SHA.
- `npm run setup` (copies the prebuilt `-nosre` bundles into `public/mathjax/`).
- See the **update-fonts** skill for details.

### 2. Update the credits (if deps or fonts changed)
The open-source + font list lives in THREE places that must agree:
- `src-tauri/Credits.html` — the macOS About panel (centered, auto-loaded).
- `ABOUT_CREDITS` in `src-tauri/src/lib.rs` — the Windows/Linux About text.
- the **Fonts** line in `CLAUDE.md`.

All bundled fonts are **SIL OFL 1.1**; the set is `src/lib/fontRegistry.mjs` —
**10 font families** (`FONT_PACKAGES`, each with a math pack) + monospace code
fonts (`MONO_FONT_PACKAGES`, no math). Keep credit names matching the picker labels.

### 3. Icons / artwork up to date (when a source SVG changed)
The shipped icons are **built** from SVG sources, so editing an SVG does NOT update
the icon the app bundles until you rebuild + repack — easy to forget.
- Detect staleness: compare last-change times of the source vs the built artifact —
  `git log -1 --format=%ci -- src-tauri/icons/document/eigendeck-doc.svg` vs
  `… -- src-tauri/icons/document/eigendeck-doc.icns`. If the SVG is newer, the
  `.icns` + iconset PNGs are STALE. Same idea for the app icon (`src-tauri/icons/`).
- Rebuild from the SVG (the `.icns` repack needs **macOS `iconutil`**): follow
  `src-tauri/icons/document/README.md` — regenerate the iconset (cairosvg + pillow),
  then `iconutil -c icns …`. **Commit** the rebuilt `eigendeck-doc.icns` + iconset.

### 4. Bump the version everywhere
Same YY.M.D (today's date) in ALL of:
`src-tauri/tauri.conf.json`, `package.json`, `package-lock.json` (2 occurrences),
`src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` (the `name = "eigendeck"`
package). `grep -rn "<old-version>"` to be sure none are missed.

### 5. Verify green
`npm run build` · `npx vitest run` · `cd src-tauri && cargo check && cargo clippy -- -D warnings`.

> ⚠️ **`#[cfg(target_os="macos")]` code is NOT compiled by Linux `cargo check`.**
> Mac-only type/safety errors slip through (it bit us 3×: `changeCount` cast,
> `declareTypes_owner` unsafe, library validation). If you touched Rust under a
> macOS cfg, build on a Mac before tagging.

### 6. Run the FULL e2e suite (Linux only — every release)
`vitest` only covers pure units; the frontend↔Rust boundary, present mode,
demo-theme injection, text clipping (#79), notebooks, video, undo, copy/paste,
asset watch, etc. are only exercised by the **e2e probes** (`e2e/*.mjs`), which
drive the REAL built app via tauri-driver + WebKitWebDriver + xvfb. These DON'T
run on the Mac (tauri-driver is Linux-only) and AREN'T in `npm test` — so they
must be run **here in the container / CI before tagging**, not skipped.

```bash
VITE_EIGENDECK_SEAM=1 npm run build        # REQUIRED — plain build omits the seam
npm run test:e2e                            # = bash e2e/run-all.sh → "ALL E2E PASS" / exit 0
```
- `test:e2e` runs the gating manifest in `e2e/run-all.sh` (one probe per real
  feature: present mode, demo-theme injection, #79 clipping, …) and exits
  non-zero if any fail. See the **eigendeck-e2e** skill for provisioning
  (`E2E_APP` must be built; the rig is Linux-only — never the Mac).
- The manifest is a curated subset, NOT yet every `e2e/*.mjs` — when you touch a
  feature with a bespoke probe (notebook/video/undo/etc.), run that probe too
  (see `e2e/README.md`) and add it to the manifest.
- A red e2e probe blocks the tag the same as a failing unit test.

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

## Website downloads page (eigendeck-web)

The site's **`downloads.html`** (in the separate **eigendeck-web** repo; locally at
`website/`) is dynamic — it fetches the latest release from the GitHub API client-side
and shows OS-detected, direct-to-installer buttons. **No manual website edit is needed
per release** — publishing the GitHub release is what updates it.

Two things to know:
- **Publish as a FULL release (not pre-release) when it should be "stable."** The page
  prefers the newest **non-prerelease** release (and `github.com/.../releases/latest`
  only resolves to one); it falls back to the newest build with a `beta` badge if every
  release is a pre-release. So a release left as *Pre-release* shows up as beta and
  `releases/latest` 404s.
- **If the Tauri bundle asset names change**, update the filename-suffix picker regexes
  in `downloads.html` (`aarch64.dmg` / `x64.dmg` / `-setup.exe` / `.msi` / `.AppImage`
  / `.deb` / `.rpm`). Otherwise leave it alone.

## Gotchas
- **Re-tagging a version:** delete the old draft + tag first
  (`gh release delete vX.Y.Z --cleanup-tag --yes`), then re-tag at the new commit.
- **Signing + notarization:** release builds are signed with a **Developer ID
  Application** cert and **notarized** in CI (`apple-actions/import-codesign-certs` +
  tauri-action, via the `APPLE_*` repo secrets). The bundled pdfium dylib is signed
  by a `beforeBundleCommand` hook (`tools/sign-pdfium-macos.mjs`) because Tauri won't
  sign a resource dylib (#146); its download is SHA-256-pinned in `build.rs` (#147).
  A notarized build has no Gatekeeper "damaged"/"unidentified developer" warning.
- **If notarization fails**, the Actions log lists the offending binary + reason
  (e.g. an unsigned nested Mach-O, or "no secure timestamp"). An unsigned/unnotarized
  build (secrets missing) still runs locally but recipients must clear quarantine
  recursively: `xattr -dr com.apple.quarantine /Applications/Eigendeck.app`.
- **Packaged-only features:** Install LLM Tools, the About icon + centered
  credits (`Credits.html`), and pdfium PDF rendering only work in a packaged
  build — exercise them after the build, not in `tauri dev`.
