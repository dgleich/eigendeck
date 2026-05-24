# Eigendeck Plugin System — Design Notes

Not committed to yet. Captured from a design-critique session so we don't
lose it. Read before designing the real plugin system.

## Goals

Extensions can generate slide content. Output is primarily SVG, but may
also be raster image, HTML demo, or text-with-math element. Two starter
plugin ideas drove the design:

1. **Add Creative Commons image** — search CC-licensed sources, insert with
   attribution.
2. **Blur filter** — apply gaussian blur to part of a slide (overlay or
   transform of an existing image).

## Plugin idea catalog

| # | Plugin | One-liner | Output |
|---|---|---|---|
| 1 | SMILES → 2D structure | Paste `c1ccccc1O` → phenol diagram | SVG |
| 2 | 3D molecule viewer | PDB/MOL id → rotatable structure | HTML demo (3Dmol.js iframe) |
| 3 | TikZ render | LaTeX-y diagram source → picture | SVG (WASM tikzjax) |
| 4 | Plot from equation | `y = sin(x)/x, -10..10` | SVG (Plotly/uplot) |
| 5 | Chart from CSV/JSON | paste data, pick chart type | SVG, re-renderable |
| 6 | Geogebra construction | interactive geometry | HTML demo |
| 7 | Syntax-highlighted code | paste code + language | SVG (Shiki → SVG) |
| 8 | Notebook cell output | `.ipynb` path + cell id | image + text-with-math |
| 9 | Citation from DOI/Zotero/BibTeX | DOI → formatted reference text | text-with-math |
| 10 | LilyPond → music score | notation text → staff | SVG |
| 11 | Circuitikz | netlist → schematic | SVG |
| 12 | Map snippet | lat/lon + zoom → static map tile | image + attribution |
| 13 | QR code | URL → QR | SVG |
| 14 | Color palette/swatch | hex list → swatches | SVG |
| 15 | Mermaid / sequence diagram | Mermaid src → diagram | SVG |
| 16 | Sparkline | inline numbers → tiny chart | SVG |
| 17 | Table from CSV | data → formatted table with math cells | SVG or HTML demo |
| 18 | Phylogenetic tree (Newick) | Newick → dendrogram | SVG |
| 19 | Camera/screenshot capture | grab from desktop region (ScreenCaptureKit) | image + crop state |
| 20 | Live data badge | URL polled every N min (CI status, citation count) | text with refresh state |

## Architecture sketch

### Discovery & loading — three tiers

- `bundled/` (first-party, in-tree under `src/plugins/`, compiled with the app)
- `~/Library/Application Support/eigendeck/plugins/<id>/` (user-installed; one folder = one extracted zip)
- Marketplace (phase 2): JSON index hosted somewhere; "Install" downloads zip to the user folder.

A plugin folder is `manifest.json` + `index.html` + bundled JS/CSS. Loader
scans on app start, plus on-demand from a Plugins menu item.

### Sandbox / security

Default: iframe with `sandbox="allow-scripts"` (no same-origin, no parent
DOM). Plugin loads its own `index.html` from a custom `eigendeck-plugin://<id>/`
Tauri asset-protocol scheme. Communication is `postMessage` only with a
typed RPC envelope. Matches the existing demo iframe pattern.

Trusted bundled plugins may opt-in to `allow-same-origin` via a manifest
field the loader only honors for signed/in-tree plugins. Untrusted
third-party = no escape hatch.

Network: per-plugin CSP injected via the asset-protocol response headers
in Rust. Manifest declares `permissions: ["network:openverse.org", ...]`
and Rust's CSP `connect-src` lists only those origins.

Filesystem: no direct access. Plugins must ask the host
(`host.openFile()`) which goes through Tauri's dialog plugin.

### UI integration points (declared in manifest)

```json
"contributes": {
  "toolbar":     [{ "id": "cc-image", "label": "CC Image", "icon": "..." }],
  "menu":        [{ "path": "Insert/Creative Commons Image..." }],
  "inspector":   [{ "for": "image", "label": "Blur" }],
  "contextMenu": [{ "selector": "image", "label": "Blur this" }],
  "dropTarget":  [{ "mime": "chemical/x-smiles" }]
}
```

The host injects toolbar buttons (`Toolbar.tsx`) and native menu items
(`lib.rs build_app_menu`) from this list.

### Manifest fields

`id`, `name`, `version`, `entry` (html path), `kind`
(`insert`/`transform`/`inspector`/`background`/`generator`), `outputs`
(`["svg","image","demo","text"]`), `permissions`, `contributes`,
`author`, `license`, `trusted: bool` (set by loader, not declarable).

### Output contract

Plugins post a `result` message:

```ts
type PluginResult =
  | { kind: 'svg',   svg: string,   bbox?: {w,h}, state?: unknown, attribution?: string }
  | { kind: 'image', bytes: Uint8Array, mime: string, state?: unknown, attribution?: string }
  | { kind: 'demo',  html: string,  state?: unknown }
  | { kind: 'text',  html: string,  state?: unknown }
  | { kind: 'patch', ops: ElementPatch[] }           // for transforms
  | { kind: 'choices', options: PluginResult[] }     // user picks one
```

Host wraps into a SlideElement, stores `state` in a new `pluginState`
field on the element, routes svg/image/pdf through existing
`asset_blob` + `asset_cache` pipeline (svg gets a `source_id`, rasterized
to thumb/full just like a user-imported svg).

### Lifecycle

`init(host) → mount UI`, `invoke(args, state?) → result`, `dispose()`.
State persists in the element so re-opening the inspector calls `invoke`
with the previous state — SMILES string round-trips, chart CSV
round-trips. If a plugin is uninstalled, elements still render from
cached PNG; "Edit" button just disables.

### Authoring DX

Browser JS/TS only (v1). Plugin authors get `host` postMessage API typed
by a `@eigendeck/plugin-sdk` npm package. Python via PyScript = doable in
v2 by shipping a base template. Native binaries = out of scope
(sandboxing nightmare on Mac with notarization).

## Plugin types — unifying contract

One core lifecycle (init/invoke/dispose) + one result envelope covers
most cases. Variation is mostly in **trigger** and **target**:

- **Insert-on-demand** (#1, 4, 9): toolbar/menu trigger, no input target → `invoke(undefined)` → result becomes a new element.
- **Transform** (blur, #14 swatch-from-image): context menu on selection, target = element id → `invoke({element})` → `kind:'patch'` or new element replacing selection.
- **Inspector accessory**: same `invoke` but UI mounts inline in PropertiesPanel; may call `invoke` repeatedly as user tweaks; doesn't auto-close.
- **Generator** (chart from CSV): identical to insert-on-demand, but persisted `state` enables an "Edit data" button that re-opens the plugin pre-populated.
- **Background service** (#20 live data): genuinely different — runs in a hidden iframe at app boot, posts `update` messages targeting elements by `pluginInstanceId`. Needs a separate `services` section in manifest and a host-side scheduler.

**One API for 4 of 5**, plus a thin extra surface for background services.

## Tough forks-in-the-road

### A. Plugin distribution
- *In-tree only / npm / zip-in-userdir / GitHub-fetched.*
- In-tree: easy review/font integration/zero-install UX — but you become the bottleneck for every plugin idea.
- npm: dev-friendly, semver, audit — but requires Node at runtime or a build step; Mac users expect zero terminal.
- Zip in userdir: works offline, no infra (VS Code pre-marketplace shape) — no auto-update, no signature checks initially.
- GitHub-fetched (curated index pointing at release zips): hybrid; don't host binaries; curate the index.

### B. Font access from plugins
- *Inject the deck's font CSS into the iframe, vs. render plugin SVG into the parent DOM, vs. plugins ship their own fonts.*
- Inject `@font-face` into the iframe: TikZ blends with slide text — but plugin SVG references `'PT Sans'` literally and breaks if user later swaps the font package. Either rewrite font-family on the SVG at re-theme time, or have plugins emit `font-family: var(--deck-title-font)` and the renderer substitutes at draw time. Latter is cleaner but constrains plugin output.
- Plugins ship own fonts: predictable but jarring across a deck.

### C. Asset cache integration
- *Treat plugin output exactly like user-imported (asset_blob + source_id + ASSET_TIER rasterization) vs. plugins manage own caching.*
- Same pipeline: free thumbnail/export, but edit round-trip must bust the cache (`clearAssetCache` on re-render — already exists). E.g.: SMILES plugin invokes, returns svg bytes, host stores in asset_blob as `plugin:smiles/<hash>.svg`, asset_cache rasterizes to PNG 256/1920. User edits SMILES, new svg, new source_id, old cache GC'd.
- Plugin manages own: more freedom (animated outputs) but reinvents.

### D. Editability vs. opacity
- *Store inputs (SMILES, CSV, equation) so plugins re-render later, vs. one-shot insertion.*
- Storing state ties presentations to plugin availability (open `.eigendeck` on a machine without the chemistry plugin → image works but "Edit" is dead). E.g.: store `pluginState: { pluginId, version, input }` on element; render falls back to cached PNG; "Re-edit requires plugin X" badge if missing.
- One-shot is simpler but loses the killer feature (data updates, typo fixes).

### E. Permissions model
- *Per-plugin explicit grant on install (manifest declares, user clicks "Allow") vs. implicit-by-type vs. always-prompt.*
- Explicit-on-install = malware-resistant, familiar (browser extension model), but adds friction; users blindly approve. E.g.: CC image plugin's install dialog: "This plugin will contact: commons.wikimedia.org, openverse.org, api.unsplash.com — Allow?"
- Implicit-by-type (insert plugins get network, transform plugins don't): less friction, surprises power users.
- Most third-party plugins want network — start strict, loosen later.

## Worked examples

- **CC image plugin**: manifest `kind:"insert"`, `outputs:["image"]`, `permissions:["network:commons.wikimedia.org","network:api.openverse.engineering"]`, contributes a toolbar button. User clicks → iframe modal → searches, picks → postMessage `{kind:'image', bytes, mime:'image/jpeg', attribution:'CC-BY ...'}` → host inserts ImageElement with new `attribution` field rendered as a footnote on export.
- **Blur transform**: `kind:"transform"`, `outputs:["svg"]`, no permissions, contributes context-menu item for `image` selector. User right-clicks image → iframe with stdDeviation slider → live preview via repeated `invoke` → Apply → returns `{kind:'svg', svg:'<svg><filter>...<image href="..."/></svg>', state:{stdDev:8}}` → host creates new ImageElement with `kind:'svg'`, asset_cache rasterizes. Re-opening from PropertiesPanel re-invokes with `state:{stdDev:8}`.
- **SMILES**: invoke with `state:{smiles:"c1ccccc1O"}` → svg back → stored as svg in asset_blob, raster cache populated, `pluginState` on element makes Cmd+E re-open plugin pre-filled.
- **Live citation count** (background service): manifest `services:[{id:"scholar-poll", interval:"6h"}]`, hidden iframe at boot, posts `{type:'updateElement', instanceId, html:"cited 1,234x"}` → host patches matching text element. Manifest declares `permissions:["network:scholar.google.com"]` and "this plugin runs in the background" warning at install.

## Critical files for implementation (when we get there)

- `/work/src/types/presentation.ts` — add `attribution`, `pluginState` fields; possibly a unified plugin-output element wrapper
- `/work/src/store/presentation.ts` — `addElement` + new `applyPluginPatch` action; element editability hooks
- `/work/src/lib/assetCache.ts` + `/work/src/lib/assetRenderer.ts` — route plugin svg/image output through existing `source_id` + `ASSET_TIER` pipeline
- `/work/src/components/Toolbar.tsx` + `/work/src/components/PropertiesPanel.tsx` + `/work/src/components/ContextMenu.tsx` — mount plugin-contributed buttons/panels/menu items
- `/work/src-tauri/src/lib.rs` — register `eigendeck-plugin://` asset protocol with per-plugin CSP, extend `build_app_menu` to inject plugin menu items
- `/work/src-tauri/src/plugins.rs` (new) — discovery/install

## Open questions (not decided yet)

1. **Distribution model** — fork A above.
2. **Permissions UX** — fork E above.
3. **First three plugins to ship** — pick from the catalog. Probably CC image (proves network + image insertion) + blur (proves transform) + one diagram generator (SMILES or Mermaid — proves svg-output + persisted state for re-edit).
4. **Whether persisted state needs schema support** — `pluginState: { pluginId, version, input }` on ImageElement might be enough, or we need a separate `plugins` table for cross-element state.
