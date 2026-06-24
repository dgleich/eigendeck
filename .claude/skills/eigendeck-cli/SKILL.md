---
name: eigendeck-cli
description: Build, inspect, and edit .eigendeck decks from the command line — especially BUILDING a deck programmatically from JSON, including decks with embedded demo/image assets (the store-asset → export --with-assets → expand JSON → import json round-trip). Use when you need to generate a test deck, a per-font/per-theme matrix, a fixture, or bulk-edit slides/elements without the GUI.
---

# eigendeck-cli — build & edit decks headless

`eigendeck-cli <file.eigendeck> <verb> [args]` reads/writes the SQLite `.eigendeck`
directly (shared storage code with the app). Use it to generate decks, audit
content, or bulk-edit — no GUI.

## The binary
Built into the Tauri target (gitignored):
- `src-tauri/target/debug/eigendeck-cli` — **the dev-box build (Linux aarch64)**; use this here.
- `src-tauri/target/release/eigendeck-cli` — synced from the Mac (Mach-O); won't run on Linux.

`file` it if unsure. Rebuild: `cd src-tauri && cargo build --bin eigendeck-cli`.

## Verbs (see `--help`)
Read: `info`, `list slides`, `list elements <n>`, `show slide <n>`, `show element <id>`,
`outline`, `search <q>`, `get-text <id>`, `history`, `validate`, `export json [out] [--with-assets]`.
Write: `set-text`, `add slide|text`, `insert slide`, `remove slide|element`, `move slide|element`,
`edit element <id> <json>`, `import json <in.json>`, `store-asset <file> [--as <path>]`,
`compact [--all]`, `unpack [--demos] [--images]`.

`--json` for machine-readable reads. `--force` to edit a deck open in the editor (risky — the
app's next save can clobber CLI edits; the CLI otherwise refuses if a `-wal` sidecar is present).

## Building a deck from JSON

`import json` builds the deck in a **fresh in-memory DB** from the JSON, then atomically
saves over the target file (like the GUI's New Project). It is NOT a merge — the target's old
content is replaced — but **embedded assets in the JSON are preserved**.

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
- Slide-level font overrides: `bodyFont` / `titleFont` / `hypeFont` (font-package ids, see
  `src/lib/fontRegistry.mjs`). `theme` = `white|light|dark|black` (see `src/lib/themes.ts`).
- A `demo` element references its asset by **`assetId`** (the app loads it via that id).

### Text-only deck (no assets) — easy
Write the JSON, then `import json`. (Used by the **update-fonts** skill for per-font specimen decks.)

### Deck WITH demos/images — the asset round-trip
The bytes must travel in the JSON. Don't hand-write base64 — let the CLI produce it:

```bash
CLI=src-tauri/target/debug/eigendeck-cli
cp examples/intro-slide.eigendeck /tmp/base.eigendeck     # any deck so the file exists
$CLI /tmp/base.eigendeck store-asset path/to/demo.html --as demos/demo.html
$CLI /tmp/base.eigendeck export json --with-assets > /tmp/base.json   # has assetId + base64 bytes
```
Then expand the JSON (Python/Node): read `assets[0].assetId`, build the slides you want with
`{type:'demo', assetId, position}` + per-slide `theme`/`bodyFont`, set `slides`, KEEP `assets`,
write it out, and import:
```bash
$CLI /tmp/target.eigendeck import json /tmp/expanded.json   # target file must already exist
$CLI /tmp/target.eigendeck list slides                      # verify
$CLI /tmp/target.eigendeck export json --with-assets | python3 -c "import sys,json;print('assets',len(json.load(sys.stdin)['assets']))"
```

### Worked example — font × theme matrix (#86)
`e2e/fixtures/theme-probe-demo.html` is a demo that uses every `--eigendeck-*` var. To build a
40-slide deck (10 `FONT_PACKAGES` × 4 themes), each a full-bleed copy of that demo:
1. `store-asset e2e/fixtures/theme-probe-demo.html --as demos/theme-probe.html`
2. `export json --with-assets` → read the assetId
3. nested loop over fonts×themes → one slide each (`bodyFont`, `theme`, one demo element)
4. `import json`
(Live render of the result is checked by `e2e/demo-theme-deck-verify.mjs`.)

## Gotchas
- **This is THE way to build/persist a deck programmatically — do NOT script the GUI/e2e seam
  instead.** Driving the editor headlessly (`store.addElement(...)` over WebDriver, then
  `__eigendeck.save()`) silently persists almost nothing: `save()`→`flushToSqlite` only replays
  store-subscription deltas, which don't reliably capture bulk programmatic adds. Assets persist
  (direct `invoke`) but elements don't → the deck opens **blank** (assets embedded, slides empty).
  `import json` writes slides+elements+assets directly in one shot. (See the `eigendeck-e2e` skill.)
- **Start from an EMPTY/known deck, not a content-laden template.** `import json` replaces structure
  but its fresh-DB clean-slate is what gives a junk-free file; building on top of e.g.
  `examples/intro-slide.eigendeck` (which carries its own slides + stray demo assets + history)
  leaves that cruft behind. Verify after: `info` + `list slides`, and for a clean download,
  `compact`.
- **`import json` replaces, not merges.** To add to an existing deck, `export json --with-assets`,
  edit, re-`import`. Or use `add`/`edit element` verbs for in-place tweaks.
- **`--with-assets` is required** to carry demo/image bytes; plain `export json` omits the
  `assets` array and an imported deck would have dangling `assetId`s.
- **WAL sidecar:** if the deck is open in the app, a `-wal`/`-shm` holds uncommitted state and the
  CLI refuses to write (use `--force` only if you accept clobbering). When copying a deck file,
  the app may hold unsaved slides in `-wal` — copy after the app closes, or `compact` first.
- **`src/store/presentation.ts` reads as binary to grep** — use `grep -a`.
- **`compact [--all]`** checkpoints the WAL and shrinks the file (drops history with `--all`).
