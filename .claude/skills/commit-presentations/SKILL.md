---
name: commit-presentations
description: This skill should be used when the user asks to commit modified or new `.eigendeck` files (examples/ or test-presentations/) to git. It enforces two prerequisites before committing - history-state is stripped (no temporal rows or asset_cache pollution from a test session) and the file loads cleanly under the current schema.
version: 0.1.0
---

# Commit Eigendeck Presentations

## When to use

The user is about to commit changes to one or more `.eigendeck` files
in `examples/` or `test-presentations/`. Typical triggers:

- "Commit the example presentations."
- "Stage the test decks."
- "Let me commit these eigendeck changes."

Plain text edits in code are NOT this skill — only `.eigendeck` SQLite
files need this gating because they accumulate test-session state.

## Why this exists

`.eigendeck` files are SQLite databases. The schema uses **temporal
tables** (`elements`, `slide_elements`, `slides`, `assets` keep
historical rows with `valid_to IS NOT NULL`) and an `asset_cache`
table that fills with rendered PNGs as the user opens the deck.

Committing a deck right after testing snapshots all that
session-specific state into git. Two real consequences:

1. **Binary bloat in git history** — asset_cache PNGs can add MBs
   per commit; temporal rows add metadata churn.
2. **Non-determinism** — re-running the same edits produces different
   bytes because of timestamps and cache PNG ordering, so diffs
   between committed versions are misleading.

Plus: a committed deck must actually LOAD under the current schema.
A migration regression that breaks an example deck silently is
caught by the schema-compat test, which this skill also runs.

## Process

Run the two gates IN ORDER, refuse to commit if either fails:

### Gate 1 — history-state check

```bash
uv run tools/check_deck_history.py <paths>
```

Pass: exit 0, prints `✓` for each clean deck.
Fail: exit 1, prints `✗` with counts of historical rows / cache
rows / sidecar files.

**If gate 1 fails**: do NOT commit. Tell the user to strip history
via the Eigendeck app:
- Open each dirty deck in the app
- Debug menu → **Strip History** (or invoke `db_compact(true)`
  via the debug console for the same effect — wipes all
  `valid_to IS NOT NULL` rows, GCs orphan assets, VACUUMs)
- Save
- Quit (so SQLite checkpoints + removes WAL/SHM sidecars)
- Re-run this skill

The tool can't strip directly — it would have to reimplement the
asset-GC semantics that live in the Rust storage layer. The app
owns the strip; the tool only detects.

### Gate 2 — schema-compat

```bash
cd src-tauri && cargo test --test schema_compat -- --nocapture
```

Pass: all listed decks under `examples/*.eigendeck` open + export
cleanly. (Currently does NOT include `test-presentations/` — extend
if relevant.) Time: ~0.2s after compile.

**If gate 2 fails**: do NOT commit. A schema or migration change
has broken one of the example decks; either fix the migration or
regenerate the affected deck.

### Gate 3 — staging

If both gates pass:
- Stage the affected `.eigendeck` files (`git add path/to/foo.eigendeck`).
- Do NOT use `git add -A` or `git add .` — would also stage
  scratch files (`Untitled-N.eigendeck`, `pdf-stress-test.eigendeck-shm`,
  etc.). Stage by explicit path only.
- Confirm via `git diff --cached --stat` before committing.

### Commit message

Use a message that explains WHY the deck changed (schema migration
ran on open? content edit? regenerated from a tool?), not just
what files changed.

Templates:

- After schema migration: `examples: re-snapshot under <new-schema-feature>`
- After content edit: `<deck-name>: <what changed>`
- After regeneration: `<deck-name>: regenerate from tools/build_<x>.py`

## What NOT to commit (skip these even if user says "everything")

- `*.eigendeck-shm`, `*.eigendeck-wal` — SQLite sidecars; user state
- `examples/Untitled-N.eigendeck` (N is a number) — user scratch
- `test-presentations/pdf-stress-test.eigendeck` — 416 MB regenerable
  artifact; the script `tools/build_pdf_stress_test.py` produces it
- `test-presentations/pdf-stress-test.eigendeck.pure` — same
- Any `.eigendeck` over ~10 MB without explicit confirmation that
  the size is canonical (typical examples are 100KB–1MB; multi-MB
  usually means embedded assets that should be referenced by path)

## Quick reference: full command sequence

```bash
# 1. Lint
uv run tools/check_deck_history.py examples/foo.eigendeck examples/bar.eigendeck

# 2. Schema compat (only if gate 1 passed)
( cd src-tauri && cargo test --test schema_compat -- --nocapture )

# 3. Stage explicitly
git add examples/foo.eigendeck examples/bar.eigendeck

# 4. Commit with a meaningful message
git commit -m "examples: ..."
```
