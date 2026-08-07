# 2026-08-07 — Beta release 26.8.7 + SPEC.md audit (autonomous, overnight)

David went to bed and asked me to (1) cut a new beta release, then (2) review
docs/SPEC.md and have an agent review + update it (#137). Working autonomously,
keeping these notes.

## Context going in

- main = `0413ee7` (version bumped to 26.8.7). Prior work this arc all merged:
  #109 print layer, snapshot commands, #174 title-wrap, #175 overflow-badge leak,
  #176 PDF export fade/counter overlay.
- Release-tagged issues cleaned up: closed #175, #176, #160, #173, #151; removed
  the `release` label from #63 (another session couldn't repro; kept OPEN, unlabeled,
  documented). Remaining release-tagged: **#137** (SPEC audit — tonight's task 2)
  and **#115** (preview perf — not a blocker).

## Container reset mid-session

The container reset wiped the WHOLE toolchain, not just /tmp: cargo/rustup,
tauri-driver, Xvfb, WebKitWebDriver, and /tmp/el-target were all gone. node_modules
and public/mathjax survived (they live under /work). Re-provisioned per the
eigendeck-e2e skill: rustup (minimal) + clippy, apt tauri build deps + xvfb +
webkit2gtk-driver, `cargo install tauri-driver`. Rebuilt the seam dist
(VITE_EIGENDECK_SEAM=1) and the app binaries into /tmp/el-target.

## Release pre-flight (26.8.7)

- Fonts: mathjax-fonts already at the pinned SHA `34075ed` — no bump.
- Credits/icons: no new deps, no icon-SVG changes this session — unchanged.
- Version bumped 26.7.23 → 26.8.7 in package.json, package-lock.json (x2),
  tauri.conf.json, Cargo.toml, Cargo.lock (eigendeck pkg). Committed `0413ee7`.
- npm build ✓, vitest 1513 passed ✓.
- cargo clippy / app build: [in progress after re-provision]
- full e2e (run-all.sh): [pending build]
- perf snapshot (perf-suite-run.sh): [pending build]

## Progress log

- Re-provisioned toolchain after the reset (rustup+clippy, apt tauri/xvfb/webkit-driver,
  cargo install tauri-driver). Built app + cli into /tmp/el-target.
- Gates ALL GREEN: npm build ✓ · vitest 1513 passed ✓ · clippy -D warnings ✓ ·
  full e2e 116/116 (ALL E2E PASS) ✓ · perf baseline recorded (9 decks,
  e2e/perf-results/v26.7.23-33-g0413ee7.json — presentAdvance ~17-75ms, sane).
- Commits: 0413ee7 (version bump 26.8.7), a14fd79 (perf baseline). Pushed main.
- **Tagged v26.8.7 at a14fd79, pushed → CI build run 31147785254 in_progress**
  (4 arch jobs; ~10-15 min). Will verify draft assets + notarization, then publish
  as a beta pre-release (project convention: every release is a -beta pre-release).
- Dispatched the SPEC.md audit agent (#137) to run in parallel with the CI build.

## SPEC.md audit (#137) — DONE

Dispatched a general-purpose agent to audit docs/SPEC.md against the code, then
human-verified its riskiest claims (layout field gone ✓, DEFAULT_FONT_ID/
FOOTER_DEFAULT_FONT_ID = 'lato' ✓) and read the full 132+/69- diff — all accurate.
Key corrections: SQLite `.eigendeck` file format + incremental/temporal save (was
"directory of presentation.json + demos/ + images/ + 20 JSON backups"); image/demo
`src` path → `assetId`; removed the dead per-slide `layout` field + enum; added
arrow heads/opacity (#98), text style props, slide groupId/theme/font-overrides/
omitFooter; 10-font registry (default Lato) + per-font `-nosre` math packs; the
three real export commands + Snapshots; fixed the keyboard-shortcut table; pruned
shipped Future items (PDF export, MathJax tilde, Tacky=hype); marked Linked Objects
implemented. Also fixed a stale `footerFont` type comment (PT Sans → Lato) in
presentation.ts. Committed e0addb4, pushed. **#137 closed.**

## Release finish — DONE

CI run 31147785254: all 4 arch jobs SUCCESS (macOS-x64, macOS-ARM64, Linux-x64,
Windows-x64). Notarization **Accepted** (id ce1215be…, "Processing complete"),
Developer ID cert imported. Draft had all 9 expected assets (both Mac DMGs +
2 .app.tar.gz, Linux .deb/.AppImage/.rpm, Windows -setup.exe/.msi). Wrote release
notes (What's new: #109 printable HTML, snapshots, #176 PDF progress, #175 badge,
#174 title-wrap, #160 paste file, #173 ⌘A, menu ellipsis, SPEC audit).

**Published v26.8.7 as a beta pre-release** (prerelease=true, draft=false) —
matches the prior release v26.7.23 (also pre-release) and David's "beta release"
request. The downloads page falls back to the newest pre-release, so it picks this
up automatically. URL: https://github.com/dgleich/eigendeck/releases/tag/v26.8.7

## Final state

- main = e0addb4 (pushed). Tag v26.8.7 at a14fd79 (version bump + perf baseline).
- Both overnight tasks DONE: beta release published + SPEC.md audit merged (#137).
- Open release-tagged issues remaining: only **#115** (preview/thumbnail feels
  slower — perf investigation, not a blocker). Everything else this arc closed.
