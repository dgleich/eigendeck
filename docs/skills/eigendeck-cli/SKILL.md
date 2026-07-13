---
name: eigendeck-cli
description: Build, inspect, and edit .eigendeck decks from the command line with the eigendeck-cli tool that ships with the Eigendeck app — especially BUILDING a deck programmatically from JSON, including decks with embedded demo/image assets (the store-asset → export --with-assets → expand JSON → import json round-trip). Use when you need to generate a deck, a per-font/per-theme matrix, a fixture, or bulk-edit slides/elements without opening the GUI.
---

# eigendeck-cli — build & edit decks headless

`eigendeck-cli <file.eigendeck> <verb> [args]` reads and writes the `.eigendeck`
file directly (it shares the app's storage code). Use it to generate decks, audit
content, or bulk-edit — no GUI.

## Getting the binary

`eigendeck-cli` ships **with the Eigendeck app**. To make it available on your
machine, open Eigendeck and choose **File → Install LLM Tools**. That writes an
`eigendeck-llm-tools/` kit (into a folder you pick) containing:

- an **`AGENTS.md`** with the **absolute path** to your installed `eigendeck-cli`
  binary, plus
- reference docs an agent can read.

After installing, read that `AGENTS.md` to learn the exact path, then invoke:

```bash
eigendeck-cli <deck.eigendeck> <verb> [args]
```

Examples below write `eigendeck-cli`; substitute the absolute path from your
kit's `AGENTS.md` (or add it to your `PATH`).

Run `eigendeck-cli --help` (or `eigendeck-cli <verb> --help`) at any time for the
authoritative verb list on your version.

## Verbs

Read: `info`, `list slides`, `list elements <n>`, `show slide <n>`, `show element <id>`,
`outline`, `search <q>`, `get-text <id>`, `history`, `validate`, `export json [out] [--with-assets]`.

Write: `set-text`, `add slide|text`, `insert slide`, `remove slide|element`, `move slide|element`,
`edit element <id> <json>`, `import json <in.json>`, `store-asset <file> [--as <path>]`,
`compact [--all]`, `unpack [--demos] [--images]`.

Add `--json` to any read for machine-readable output. Add `--force` to edit a deck
that is currently open in the editor (risky — the app's next save can clobber your
CLI edits; the CLI otherwise refuses when a `-wal` sidecar is present, see Gotchas).

## Building a deck from JSON

`import json` builds the deck in a **fresh in-memory database** from the JSON, then
atomically saves over the target file (like the app's New Project). It is **NOT a
merge** — the target's old content is replaced — but **embedded assets in the JSON
are preserved**.

### Schema (what `export json` emits / `import json` accepts)

```jsonc
{
  "title": "...", "theme": "white",
  "config": { "width":1920, "height":1080, "defaultBodyFont":"...", "textSizes":{...}, ... },
  "slides": [
    { "id":"<uuid>", "theme":"black", "bodyFont":"lato", "notes":"",
      "elements":[
        { "id":"<uuid>", "type":"text", "preset":"body", "html":"...", "position":{...} },
        { "id":"<uuid>", "type":"demo", "assetId":"<uuid>", "position":{"x":0,"y":0,"width":1920,"height":1080} }
      ] }
  ],
  // present ONLY with --with-assets; required to recreate demo/image bytes:
  "assets": [ { "assetId":"<uuid>", "path":"demos/foo.html", "mime":"text/html",
               "data":"<base64>", "size":2847, "hash":"...", "createdAt":"..." } ]
}
```

- **Top-level `config`**: always include at least `{ "width":1920, "height":1080 }`.
  Eigendeck defaults to this, but a deck missing it can present to a collapsed 0×0
  stage on some builds (shows nothing).
- **`theme`** (deck-level or per-slide) is one of `white | light | dark | black`.
- **Slide-level font overrides**: `bodyFont` / `titleFont` / `hypeFont` take
  font-package ids. For the valid ids, see the font list in Eigendeck's font
  picker (Inspector → font dropdowns) — each entry there is a usable id.
- A `demo` (or `image`) element references its bytes by **`assetId`**; the app
  loads the asset by that id. The bytes themselves live in the `assets[]` array.

### Text-only deck (no assets) — easy

Write the JSON, then `import json`. This is the whole workflow when your slides are
just text (and native fonts/themes) — no asset round-trip needed:

```bash
eigendeck-cli my-deck.eigendeck import json my-deck.json
eigendeck-cli my-deck.eigendeck list slides            # verify
```

The target file does not need to pre-exist for `import json`; it is created/overwritten.

### Deck WITH demos/images — the asset round-trip

Embedded bytes must travel **inside the JSON** as base64. Don't hand-write that
base64 — let the CLI produce it, then reuse the emitted `assetId`:

```bash
# 1. Stash the asset bytes into a deck and let the CLI hash + register them.
eigendeck-cli my-deck.eigendeck store-asset demo.html --as demos/demo.html

# 2. Export WITH assets — this JSON now carries the assetId + base64 bytes.
eigendeck-cli my-deck.eigendeck export json --with-assets > my-deck.json
```

Then **expand the JSON** (Python/Node): read `assets[0].assetId`, build the slides
you want with `{ "type":"demo", "assetId":"<that id>", "position":{...} }` plus any
per-slide `theme`/`bodyFont`, set `slides`, **KEEP the `assets` array**, and write
it back out. Re-import:

```bash
eigendeck-cli my-deck.eigendeck import json my-deck.json    # rebuilds slides+assets in one shot
eigendeck-cli my-deck.eigendeck list slides                 # verify structure
eigendeck-cli my-deck.eigendeck export json --with-assets \
  | python3 -c "import sys,json;print('assets',len(json.load(sys.stdin)['assets']))"
```

### Worked example — a font × theme matrix

Say you have `demo.html` (a demo you want to preview against every font and theme)
and you want a deck with one full-bleed copy of it per (font, theme) combination:

1. `eigendeck-cli matrix.eigendeck store-asset demo.html --as demos/demo.html`
2. `eigendeck-cli matrix.eigendeck export json --with-assets > matrix.json` → read the `assetId`.
3. In a small script, loop over your chosen font ids × the four themes
   (`white`/`light`/`dark`/`black`) → emit one slide each: `bodyFont` set, `theme`
   set, and a single `demo` element referencing that one `assetId`. Keep `assets`.
4. `eigendeck-cli matrix.eigendeck import json matrix.json`.

Because every slide reuses the same `assetId`, the bytes are stored once and the
deck stays small.

## Gotchas

- **`import json` replaces, not merges.** It rebuilds the deck from scratch. To
  ADD to an existing deck, first `export json --with-assets`, edit the JSON, then
  re-`import`. For small in-place tweaks, prefer the `add` / `edit element` /
  `set-text` verbs instead.
- **Start from an EMPTY / known deck, not a content-laden one.** `import json`
  gives a junk-free file precisely because it builds in a fresh database. If you
  round-trip on top of a deck that already carries slides, stray assets, or edit
  history, that cruft can linger. Verify after with `info` + `list slides`, and
  for a clean, minimal file run `compact`.
- **`--with-assets` is required to carry demo/image bytes.** Plain `export json`
  omits the `assets` array, so an imported copy would have dangling `assetId`s and
  demos/images would fail to load. Always use `--with-assets` when the deck has
  embedded assets.
- **WAL sidecar / deck open in the app.** If the deck is open in Eigendeck, a
  `-wal`/`-shm` sidecar holds uncommitted state and the CLI refuses to write (pass
  `--force` only if you accept clobbering unsaved edits). When copying a deck file,
  the app may still hold unsaved slides in the `-wal` — copy after the app closes,
  or `compact` first to fold the sidecar into the main file.
- **`compact [--all]`** checkpoints the WAL and shrinks the file. `--all` also
  drops edit history — use it for a clean deck you intend to share or ship.

## Related skills

- **`eigendeck`** — umbrella guide for the app.
- **`frontend-slides-eigendeck`** — authoring bold designer slides with the `html`
  element; it uses this CLI's `import json` to build the deck.
- **`eigendeck-html-element`** / **`eigendeck-demo`** — the sandboxed `html`
  element and interactive demo element these decks embed as assets.
