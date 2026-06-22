# Eigendeck LLM Tools

This kit lets an AI coding agent (Claude Code, etc.) edit Eigendeck
presentation files (`.eigendeck`) and author the interactive HTML demos that
embed in slides. It was written to this folder by **File → Install LLM Tools…**
in the Eigendeck app, so the CLI path below points at *your* installed app.

## Editing a deck

`.eigendeck` files are SQLite databases. Edit them with the bundled
`eigendeck-cli` — every write is automatically versioned (undo-safe). The path
to the CLI shipped with the installed app is:

```
__EIGENDECK_CLI_PATH__
```

Always pass the deck file as the first argument, then a verb:

```bash
# Read
__EIGENDECK_CLI_PATH__ deck.eigendeck outline             # text outline of all slides
__EIGENDECK_CLI_PATH__ deck.eigendeck info                # title / slide / element counts
__EIGENDECK_CLI_PATH__ deck.eigendeck list slides         # slides with element counts
__EIGENDECK_CLI_PATH__ deck.eigendeck list elements 3     # elements on slide 3 (1-based)
__EIGENDECK_CLI_PATH__ deck.eigendeck show slide 3        # full slide JSON
__EIGENDECK_CLI_PATH__ deck.eigendeck show element abc    # full element JSON (partial id match)
__EIGENDECK_CLI_PATH__ deck.eigendeck get-text abc        # element text, HTML stripped
__EIGENDECK_CLI_PATH__ deck.eigendeck search "eigenvalue" # find text across all slides
__EIGENDECK_CLI_PATH__ deck.eigendeck history             # recent edits
__EIGENDECK_CLI_PATH__ deck.eigendeck validate            # check for issues

# Write (each creates a versioned snapshot)
__EIGENDECK_CLI_PATH__ deck.eigendeck set-text abc "New text with \$\\LaTeX\$"
__EIGENDECK_CLI_PATH__ deck.eigendeck add text 3 "A new bullet point"
__EIGENDECK_CLI_PATH__ deck.eigendeck add slide --after 5
__EIGENDECK_CLI_PATH__ deck.eigendeck insert slide 2
__EIGENDECK_CLI_PATH__ deck.eigendeck move element abc 400 300
__EIGENDECK_CLI_PATH__ deck.eigendeck move slide 3 1
__EIGENDECK_CLI_PATH__ deck.eigendeck remove element abc
__EIGENDECK_CLI_PATH__ deck.eigendeck remove slide 5
__EIGENDECK_CLI_PATH__ deck.eigendeck edit element abc '{"html":"...","position":{...}}'

# Bulk edit: export → edit JSON → reimport
__EIGENDECK_CLI_PATH__ deck.eigendeck export json /tmp/edit.json
# ...edit /tmp/edit.json...
__EIGENDECK_CLI_PATH__ deck.eigendeck import json /tmp/edit.json

# Assets / maintenance
__EIGENDECK_CLI_PATH__ deck.eigendeck store-asset img.png --as images/img.png
__EIGENDECK_CLI_PATH__ deck.eigendeck unpack --demos          # extract demos to edit
__EIGENDECK_CLI_PATH__ deck.eigendeck compact                 # prune history, shrink DB
```

Add `--json` to any read verb for machine-readable output.

**Close the deck in the Eigendeck app before editing it from the CLI** — both
write to the same SQLite file, and the app's next save would overwrite your CLI
edits. The CLI enforces this: write commands **refuse** while the deck is open
(it detects the app's active WAL sidecar), printing a message. If you're sure the
app isn't running (e.g. a leftover sidecar from a crash), re-run with `--force`.
Re-open the deck in the app afterwards to see your changes.

See **LLM-EDITING.md** for the full editing workflow and **SPEC.md** for the
complete data model (slide/element schema, text presets, themes, config).

## Authoring demos

Eigendeck demos are single self-contained HTML files embedded as `demo` /
`demo-piece` elements. Read **DEMO_AUTHORING.md** for the architecture
(controller + viewport pieces over `BroadcastChannel`) and **DEMO_SPEC.md** for
the element schema. Start from **demo-starter.html** in this folder — it's a
minimal skeleton with the required full-bleed layout.

Demos use `font-family: 'PT Sans', system-ui, sans-serif` to match Eigendeck's
typography. PT Sans is a free Google Font, so installing it locally gives an
exact preview of how the demo will look in a slide.

## Keeping this kit current

The `eigendeck-cli` path above is the absolute path to the binary inside the app
that installed this kit. If you **move or rename the Eigendeck app**, that path
breaks — re-run **File → Install LLM Tools…** from the app to regenerate this
folder with the new path.
