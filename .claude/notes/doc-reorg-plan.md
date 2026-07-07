# Doc reorg plan (root .md cleanup + AGENTS.md + website dev-setup)

Decided 2026-07-07; execute in a fresh-context session (ref-heavy). Verify each
move with `grep -rn <oldpath>` and fix links; `npm run build` + `node
tools/build-manual.mjs` at the end.

## 1. Delete
- `CHANGELOG.md` — stale (last 2026-06-01), unmaintained; git log covers it.

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
