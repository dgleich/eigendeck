# Startup notes for next session — Eigendeck asset refactor

Last updated 2026-05-27, written before a context reset. Read this
file FIRST in the next session before doing anything else.

## TL;DR

You (Claude) are mid-way through an asset-model refactor for
Eigendeck. Phases 1-3 + the design doc are shipped on
`svg-pdf-image-cache`. Phase 4 (drop `src`/`demoSrc`) is the next
chunk; phase 5 (asset GC) after that. Plan + status:
`/work/.claude/notes/asset-model-refactor-plan.md`.

## Environment

- **Linux Docker container** (aarch64), working dir `/work/`.
- `git` user is David Gleich; commits sign with co-author trailer
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Sudo access for `apt install` etc. Install whatever's needed.
- `cargo` is installed (sandbox got reset earlier in the session;
  if missing, install with `curl --proto '=https' --tlsv1.2 -sSf
  https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  --profile minimal`).
- `cargo` here can't fully link past `glib-sys` / `gobject-sys`
  (no `pkg-config` + `libglib2.0-dev` for aarch64 by default).
  Workaround for builds: `cargo check` mostly works; full `cargo
  build` and `cargo test` need GTK system deps installed first
  (`apt install -y pkg-config libglib2.0-dev libgtk-3-dev
  libsoup-3.0-dev libwebkit2gtk-4.1-dev` or similar — try if you
  need to run Rust tests locally).
- `gh` CLI at `/usr/bin/gh`. Re-auth on session start with
  `gh auth login --with-token < /work/.gh_token`.
- Node + npm installed; `npm test` runs Vitest, `npm run build`
  runs tsc + Vite.
- The user works on a **Mac Studio**; they verify Rust changes
  there because of the GTK situation. They share `cargo test`
  output back when something fails.

## The project

Eigendeck is a **Tauri v2 + React/TypeScript** desktop presentation
tool for CS professors (David Gleich, Purdue). Slides are stored in
SQLite `.eigendeck` files. Math via MathJax 4 with custom font
bundles. Self-contained binary assets (images/SVGs/PDFs/demos)
stored as bytes in SQLite.

Read `/work/CLAUDE.md` for the project guide (build commands, file
layout, critical rules).

## Overall goal of this work

**Asset model refactor**: a multi-phase cleanup of how images and
other binary content are stored, watched, and rendered. The
session-spanning design discussion settled on **Model B** — the
asset table is the source of truth for the deck; the filesystem is
the source of *changes* when watching is on, but the deck owns
the bytes for portability.

Lead reading: `/work/docs/ASSETS.md` (the canonical design doc,
just rewritten 2026-05-27, 550 lines, reflects everything
through phase 3).

The earlier per-element pinning idea was **cut** as
over-engineered after two agent brainstorms (notes in
`/work/.claude/notes/asset-model-refactor-plan.md` under "What
we're NOT doing"). The asset-scoped semantic + "Used N times
across M slides" caption is the user-facing scope signal.

## Current goal

**Phase 4 — drop `src` / `demoSrc` from element types**. Mechanical
mass-rename. After this, the element-to-asset binding is purely
via the `asset_id` column; `asset.path` is the user-facing
display label for everything.

Estimated 3-4 hours. The big risk is missing a callsite (same
shape as the `cli.rs` miss in phase 3 — make sure to grep the
entire repo, not just `src/`).

See plan for the concrete change list.

## Testing strategy (READ THIS)

`/work/.claude/notes/testing-strategy.md` has the full version.
Short version:

- **Pure-logic test** (`src/lib/*.test.ts`) — preferred for any
  testable function. Extract logic into a `lib/` helper, test the
  helper directly. Fast, deterministic.
- **Mount test** (`src/components/*.test.tsx`) — for React
  components when the rendering shape itself is what could
  break. Catches things pure-logic tests can't (e.g. the
  Zustand-selector infinite-loop bug). Pattern in
  `src/components/AssetSection.test.tsx`.
- **Rust test** — colocated in `src-tauri/src/storage.rs` mod
  tests block. Pattern in `db_store_asset_preserves_*` and the
  phase-3 column tests.

Decision table in the testing strategy doc.

If you add new code: add tests in the same commit. The session
explicitly committed to "tests are good" as a default.

## Git workflow

- **Commit after each iteration.** One change → run tests → commit.
  Don't batch multiple changes into one commit. The user's standing
  feedback is "one iteration = one commit."
- Use HEREDOC for commit messages with the co-author trailer:
  ```
  git commit -m "$(cat <<'EOF'
  Title

  Body explaining why.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
- Never push without explicit user permission. Branch is
  `svg-pdf-image-cache`, ~78 commits ahead of `main`, **unpushed**.
- Never `git add` from `src-tauri/` cwd (the subdir's relative
  paths confuse the index). Always `cd /work && git add ...`.
- Don't stage example/test `.eigendeck` files — they're user state.

## Where things live

Per-project scratch + design notes:
- `/work/.claude/notes/asset-model-refactor-plan.md` — multi-phase
  plan + current status checkpoint (read this for phase 4 details)
- `/work/.claude/notes/session-bugs-2026-05-26-to-27.md` — bug log
  from the session, useful context for design decisions
- `/work/.claude/notes/testing-strategy.md` — test type decisions
- `/work/.claude/notes/startup-notes.md` — this file
- `/work/.claude/notes/` is gitignored (see `.gitignore` rule
  `.claude/notes/`). My per-project scratch — NOT the user's.

Tracked design docs:
- `/work/docs/ASSETS.md` — the canonical asset-model design
- `/work/CLAUDE.md` — project guide
- `/work/LLM-EDITING.md` — JSON schema docs (needs phase-4 update
  to remove `src`/`demoSrc` from element examples)
- `/work/.claude/logs/` — arc-level session logs (the old root
  `CHANGELOG.md` was folded in here 2026-07-07). Append a
  `YYYY-MM-DD-...-session.md` entry when shipping a meaningful chunk.
- `/work/SPEC.md` — stale (April 15), superseded by `docs/ASSETS.md`
  for the asset domain.

User session scratch (DON'T pollute):
- `/work/gitignore/worklog-*.md` — user's session worklogs
- `/work/gitignore/issue-*.md` — issue-body drafts I write before
  `gh issue create`; the user has been OK with these living here

GitHub issues filed during this work:
- #62 Native settings window
- #63 Watcher `[TAURI] Couldn't find callback id` warnings
- #64 Split slide vs presentation properties

## User profile + standing feedback

Personal memory file: `~/.claude/projects/-work/memory/`. Has the
user's profile, preferences, and feedback from past sessions.
Notable:

- David is a CS professor; mac primary. Likes lightweight, native-
  feeling tools. Frequent committer.
- **Plain language in UI** — no jargon ("asset", "bytes",
  "watcher" leaked into a confirm dialog and got pushed back on).
- **Skeptical of agent output** — when you spawn an Agent, name
  the model (`model: "opus"` for design-level brainstorms; the
  default is cheaper and shallower).
- **Tests are part of done.** "More tests are always good" was
  the recent quote. Don't ship phase work without tests.
- **One commit per change**, with the why explained in the body.
- **Per-element semantics** were the original UX expectation but
  user accepted asset-scoped controls when the "Used N times"
  caption + single confirm proved clearer.

## Known issues to flag (not in scope for the refactor)

1. **Rust test parallel-DB race.** `cargo test` produces
   ~20 "No database open" failures because the global
   `DB: Mutex<Option<Connection>>` gets replaced by parallel
   test setups. Production-safe (only one DB open in real use,
   sequential user actions). Workaround: `cargo test --
   --test-threads=1`. Could fix properly with `serial_test`
   crate. Pre-existing; not in scope for asset refactor but
   worth flagging if you offer it.
2. **`test_add_slide` asserts `layout = "centered"`** but `layout`
   was dropped in v1→v2 migration. Pre-existing dead test.
3. **macOS atomic-save watcher orphan callbacks** (#63) — cosmetic.

## Session vibe

The user is collaborative + decisive. They redirect when I'm wrong
(repeatedly during this session — Model B framing, dropping
per-element pinning, plain UI language). Take corrections seriously
and update the design notes accordingly.

They're also testing actively on their Mac. Bug reports come in
the form "I did X, expected Y, got Z" — diagnose by reading the
relevant code, hypothesize, propose fix. Often the bug shape
matches an entry in the session bug log; check that first.

## Recommended first 5 actions in next session

1. Read this file (you just did).
2. Read `/work/.claude/notes/asset-model-refactor-plan.md` for the
   phase 4 details and what's already shipped.
3. Skim `/work/docs/ASSETS.md` — that's the canonical design doc.
4. `cd /work && git log --oneline -20` — see what's shipped and
   committed since the checkpoint.
5. Run `npm test -- --run` to confirm the JS test baseline (was
   162 passing at checkpoint).

Then start phase 4 (drop `src`/`demoSrc`) per the plan.

## If something doesn't add up

The recent commit history is your friend — `git log -p` on the
file you're touching often answers "why was this written this
way." The session has been heavy on iterative correction, so the
*current* state in `docs/ASSETS.md` is more authoritative than
older code comments that might describe pre-refactor semantics.
