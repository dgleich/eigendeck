# Cards, unified color controls, the accent token + persistence hardening (07-11)

A dense day on main, mostly the **#132** arc (themed "Card" block + one color
control + a live theme-relative accent token), plus a persistence-drift refactor,
a parallel bug-hunt, and the Lato default-font switch.

## Card = a themed block, not a new element type (#132)
- **"Card"** ships as a **themed `boxTint` on the existing text element**
  (Beamer-style block), not a new `SlideElement`. Renders across all paths + a
  test; fixed the editor-canvas tint that was missing (#132) and made **Cover grow
  past a card's shadow** when it covers it.
- **Luminance-aware tint** — dark themes *lift* instead of going muddy; shared
  `TINT_STRENGTH` const (20%). Themed-tint swatch added to the text Background
  selector; more tints exposed (accent/red/green/amber/purple), and a redundant
  bg-color row trimmed.

## One color control (#132 M2)
- **Unified every color picker into a single `<ColorControl>`** — laid a
  characterization net over all inspector + toolbar color controls *first*, then
  collapsed them onto the shared component; e2e proves `<ColorControl>` writes in
  the real inspector, and that the deck `customPalette` shows in every control.

## Live theme-relative "accent" token (#132)
- A **live `accent` color token + cover fill tint** that **re-adapts when the deck
  theme changes** (not baked at author time) + e2e for the re-adapt + LLM-EDITING
  docs for the token / `boxTint` / shared palette.

## Lato as the default font
- Default **title + body → Lato** (pairs with the `mathjax-lato` math pack). Seed
  new decks with an **explicit** Lato (not the bare default) so decks are
  self-describing; examples pinned to explicit `ptsans`; the inspector
  default-font label now **derives** the name (was hard-coded "PT Sans");
  render snapshots regenerated.

## Present-mode dark-slide fixes
- **#133 / grey-white bar at the bottom** of dark slides in present mode — fixed.
- Dark-slide **card tints saturate** instead of washing out (#132).

## Persistence hardening (the theme-never-saved bug class)
- Root cause: **deck theme change was never saved** — the flush skipped the theme
  row. Fixed, then **refactored to a single source for the persisted presentation
  rows** so this whole drift class can't recur; did the same for **slide
  metadata**; added an **exhaustive persistence-coverage guard** (every model field
  must have a writer).

## Safety + style + lists
- **Confirm BEFORE destructive actions** — a raw `confirm()` had been deleting
  first and asking after.
- **Chip style family** — extracted `src/styles/chip.css`; chipped the inspector
  buttons (font-size, linked-files, preamble), the security panel, and the top
  toolbar (Present stays a solid CTA); proper active/selected chip state.
- **#9** — list markers moved into the gutter so the caret sits to their right.
- Insert-HUD overlap fixes (wrapped to 2+ rows; overlap after present→Escape).
- Security panel: tone down colors, subtler batch-approve, show real paths, wrap
  long paths at `/` boundaries (`PathText`).

## Parallel bug-hunt
- Built a **port-isolated parallel bug-hunt harness** (runner + smoke + plan);
  fixed **3 render/lifecycle bugs** it found and the **notebook dark-output
  readability** (theme-aware cell colors); gated 8 green-guard probes
  (persistence / WYSIWYG / notebook) in `run-all`.

## State
All on main (version 26.7.9). Covered by vitest + the e2e rig; the #132 visuals
were eyeballed via headless screenshots across the render paths.
