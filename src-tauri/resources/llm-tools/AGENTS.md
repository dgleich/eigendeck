# Eigendeck LLM Tools

This folder is a self-contained kit for an AI coding agent (Claude Code, Codex,
opencode, …) to build and edit **Eigendeck** presentations (`.eigendeck` files)
and author the interactive demos and design elements that go in slides. It was
written here by **File → Install LLM Tools…** in the Eigendeck app, so the CLI
path below points at *your* installed app.

**Read this file first, then open the one skill that matches your task.** The
`skills/` folder holds focused, task-scoped guides; `reference/` holds the full
schemas for deep lookups.

## The command-line tool

`.eigendeck` files are SQLite databases. Edit them with the bundled
`eigendeck-cli` — every write is automatically versioned (undo-safe). The path to
the CLI shipped with the installed app is:

```
__EIGENDECK_CLI_PATH__
```

Pass the deck file first, then a verb (`__EIGENDECK_CLI_PATH__ deck.eigendeck outline`).
The **skills/eigendeck-cli** guide has the full verb list and the build-from-JSON
workflow.

> **Close the deck in the Eigendeck app before editing it from the CLI.** Both
> write the same SQLite file, and the app's next save would clobber your CLI
> edits. Write commands **refuse** while the app has the deck open (it detects the
> active WAL sidecar); re-run with `--force` only if you're sure the app is
> closed. Re-open in the app afterwards to see your changes.

## Which skill for which task

| Task | Open |
|------|------|
| Get oriented — the deck / slide / element model, then where to go | `skills/eigendeck/SKILL.md` (start here if unsure) |
| Build, inspect, or bulk-edit a deck from the command line | `skills/eigendeck-cli/SKILL.md` |
| A custom static / CSS-interactive design element (gradients, grids, SVG, tables) | `skills/eigendeck-html-element/SKILL.md` |
| An interactive **JavaScript** demo (D3 / Canvas / WebGL) | `skills/eigendeck-demo/SKILL.md` (start from `demo-starter.html` in this folder) |
| Bold, full-bleed "designer" HTML slides (or porting a reveal.js / Slidev deck) | `skills/frontend-slides-eigendeck/SKILL.md` |

## Full reference (deep lookups)

The skills link into these when you need the exhaustive detail:

- `reference/LLM-EDITING.md` — the complete programmatic-editing guide.
- `reference/SPEC.md` — the full data model (slide/element schema, text presets, themes, config).
- `reference/DEMO_AUTHORING.md` — the demo architecture (controller + viewport pieces, theming, the bridge).
- `reference/DEMO_SPEC.md` — the demo element schema.

## Using the skills

In **Claude Code**, these become auto-triggering Skills if you copy the folders
under `skills/` into a skills directory it reads — either this project's
`.claude/skills/` or your personal `~/.claude/skills/`. This kit does **not** do
that automatically; place them yourself if you want global auto-invocation. Left
here, every agent (Codex, opencode, Claude Code) can still read them as the
focused guides they are — this `AGENTS.md` is the index.

## Keeping this kit current

The `eigendeck-cli` path above is absolute. If you **move or rename the Eigendeck
app**, that path breaks — re-run **File → Install LLM Tools…** to regenerate this
folder (skills, reference docs, and the corrected path).
