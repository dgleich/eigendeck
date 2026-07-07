# Doc reorg plan (root .md cleanup + AGENTS.md + website dev-setup)

Decided 2026-07-07; execute in a fresh-context session (ref-heavy). Verify each
move with `grep -rn <oldpath>` and fix links; `npm run build` + `node
tools/build-manual.mjs` at the end.

## 1. CHANGELOG → fold into `.claude/logs/` — DONE 2026-07-07
- Renamed `.claude/log/` → `.claude/logs/`.
- `CHANGELOG.md`'s founding arc (Mar 31 – Apr 2) → `logs/2026-03-31-to-04-02-session.md`;
  its Notebooks arc (May 31 – Jun 1) → `logs/2026-05-31-to-06-01-notebooks-session.md`.
  Its May 19–25 asset-versioning arc was already covered by
  `logs/worklog-2026-05-19-to-05-25.md` (more detailed) → no new file.
- Deleted `CHANGELOG.md`; repointed the stale "append to CHANGELOG" note in
  `.claude/notes/startup-notes.md` to `.claude/logs/`.

## 2. Keep in root
- `README.md`, `CONTRIBUTING.md`.
- `CLAUDE.md` → becomes a **thin pointer to AGENTS.md** (see §5).

## 3. Move to `docs/` — low churn (few refs)
`DESIGN_DECISIONS.md`, `FONTS.md`, `PLUGIN_IDEAS.md`, `SQLITE_STORAGE.md`,
`FORKS.md`. (git mv, then fix the handful of cross-refs in docs/ + .claude/notes/.)

## 4. Move to `docs/` — load-bearing (move + fix ALL refs)
- `SPEC.md` → `docs/SPEC.md`: update CLAUDE.md/AGENTS.md ("See SPEC.md"), ~12 refs.
- `LLM-EDITING.md` → `docs/LLM-EDITING.md`: update CLAUDE.md/AGENTS.md, the
  **PostToolUse hook** in `.claude/settings.local.json` (mentions LLM-EDITING.md),
  ~20 refs.
- `DEMO_AUTHORING.md`, `DEMO_SPEC.md` → `docs/`: update
  - the **Install-LLM-Tools copy step** (setup script copies them from root →
    resources/llm-tools/; repoint to docs/),
  - `docs/manual/building-demos-with-llms.md` link `../../DEMO_AUTHORING.md`,
  - `build-manual.mjs` GH base-URL refs if any, ~15/7 refs.

## 5. AGENTS.md (canonical) + CLAUDE.md (pointer)
- Move CLAUDE.md's project-guide content → new root `AGENTS.md`.
- CLAUDE.md becomes just: "See [AGENTS.md](AGENTS.md)." (matches
  `src-tauri/resources/llm-tools/CLAUDE.md`, which already does this).
- Update paths inside AGENTS.md for any docs moved above (SPEC → docs/SPEC.md etc.).
- Sanity: Claude Code still auto-loads CLAUDE.md → it points to AGENTS.md. Confirm
  hooks/tooling that read CLAUDE.md still work.

## 6. Website: development-setup page(s)
- New `docs/manual/development-setup.md` consolidating `SETUP.md` + `MAC-BUILD.md`
  + the Prereqs/Build-commands from CLAUDE.md (Node 20+, Rust 1.85+, npm run
  setup/build/tauri dev, cargo check/clippy, MathJax bundle rebuild).
- Add it to `build-manual.mjs` TOC, likely a new "Development" section
  (contributor-facing) → renders at eigendeck.dev/manual/development-setup.
- Then `SETUP.md`/`MAC-BUILD.md` become the source; keep in docs/ or fold entirely
  into the manual page. NOTE: MAC-BUILD (Apr-15) is stale re: current
  signing/notarization — rewrite when the Apple Dev account/signing lands.

## Two repos
- Root moves + AGENTS.md + build-manual.mjs → `dgleich/eigendeck` (main).
- Regenerated `website/manual/*.html` (new dev page + any link changes) →
  `dgleich/eigendeck-web`.

## 7. Also found (beyond .md) — don't miss these
- **Root build scripts → `scripts/`**: `build-cli.sh` (1 ref), `mac-build.sh`
  (4 refs) — move + update refs. `linux-build.sh` (0 refs) — likely dead, verify
  then delete.
- **Stray root HTML**: `test-shift.html`, `export-cli.html` look like scratch —
  inspect + delete. KEEP `index.html` / `presenter.html` / `security.html` (Vite
  multi-page entries, referenced by vite.config).
- **`todo.txt`**: not gitignored (untracked scratch) → add to `.gitignore`.
- **Dup check**: `docs/sync-and-link.md` vs `docs/manual/sync-and-link.md` — one
  is likely stale; dedup.
- **Tokens OK**: `.gh_token` / `.github_token` / `.DS_Store` are gitignored +
  untracked (no leak) — leave as-is.

## Correction to §4/§6
Dev docs (SPEC, LLM-EDITING, DEMO_AUTHORING, DEMO_SPEC, DESIGN_DECISIONS,
SQLITE_STORAGE, FONTS) go to **`docs/`**, NOT `docs/manual/` — `docs/manual/` is
the PUBLIC website source (build-manual.mjs), so only the new
`development-setup.md` belongs there. `entitlements.plist` is correctly in
`src-tauri/` (not misplaced).

## 8. Consolidate scripts/ → tools/ (one tooling dir) — DONE 2026-07-07
Moved setup-fonts.mjs + download-fonts.mjs → tools/ (both use resolve(__dirname,'..')
so root resolution survives), scripts/ removed. Moved build-cli.sh + mac-build.sh →
tools/ (mac-build.sh's `cd "$(dirname "$0")"` → `.../..`); deleted dead linux-build.sh.
Updated refs: package.json "setup", release+update-fonts skills, docs/FONTS.md,
docs/updating-fonts.md, SPEC.md command examples, src-tauri/src/debug.rs comment,
.claude/settings.local.json Mac-path allowlist. §7 scratch (test-shift.html, todo.txt)
handled with §3; export-cli.html KEPT (it's a vite entry); sync-and-link "dup" is
NOT a dup (docs/ = design doc, docs/manual/ = user page).

--- original plan below ---
## 8. Consolidate scripts/ → tools/ (one tooling dir)
`scripts/` holds only `setup-fonts.mjs` + `download-fonts.mjs`; `tools/` holds
everything else. Merge into `tools/`, delete `scripts/`:
- `git mv scripts/setup-fonts.mjs scripts/download-fonts.mjs tools/`
- **package.json**: `"setup": "node scripts/setup-fonts.mjs"` → `node tools/setup-fonts.mjs`.
- Check setup-fonts.mjs's own import of `./download-fonts.mjs` (relative — stays OK
  after moving both together) and any `scripts/` refs in docs / the `update-fonts`
  skill / CLAUDE(AGENTS).md.
- **Root build scripts → tools/** (from §7): `git mv build-cli.sh mac-build.sh tools/`
  and update their refs (build-cli 1, mac-build 4); verify+delete `linux-build.sh`
  (0 refs). Update `convert-examples.sh`/`generate-icons.sh` are already in tools/.
Result: `tools/` is the single home for build/dev tooling; `scripts/` gone.
