# Color control unification + live theme-relative color tokens

Branch: `style/unify-buttons`. All design decisions LOCKED (user-approved).

## Goal
Unify the 5 color controls (inline text toolbar + inspector text-color / text-bg /
arrow / cover) into one `<ColorControl>`, and add live theme-relative tints
everywhere they make sense.

## Decisions (user-approved)
1. Canonical text palette = the toolbar's 17-color superset (`COLORS`), used by
   BOTH the inline bar and the inspector text-color. (TEXT_COLORS-10 is ~a subset.)
2. Add tints now: cover fill + text/arrow `accent`.
3. `accent` is a LIVE token (resolved per-theme in every render path), not a baked hex.

## Regression safety
- Committed net (0354154): `PropertiesPanel.colorControls.test.tsx` +
  `TextFormatToolbar.test.tsx` pin every affordance's exact write + palette. These
  MUST stay green through the refactor (structure change writes identical fields).
- Renderers untouched by the UI refactor; guarded by @simplify-guard snapshots +
  cardRenderPaths. The NEW live-token layer gets its own multi-path guard test.

## Milestone 1 — live-token render/data layer (do first)
- Add `resolveColor(color, theme, fallback)` to `src/lib/textStyle.mjs` (+ .d.mts +
  unit test): `!color`→fallback; `'accent'`→`theme.accent||fallback`; else literal.
- `describeArrow(el, theme)`: `color: resolveColor(el.color, theme, '#2563eb')`.
  Update 5 callers (PresentSlide, SlideThumbnail, LinkOverlay, SlideElementRenderer,
  elementHtml.mjs) + PresentMode:432 arrow-animate + .d.mts.
- `describeCover(el, theme)`: `el.boxTint ? textBackgroundResolved(el,theme) :
  (el.color||theme.background)`. Change callers to pass the ThemeColors object
  (they all already compute resolveTheme). Add `boxTint?` to cover in types + .d.mts.
- Wire text-color sites through `resolveColor(el.color, theme, themeColor)`:
  SlideElementRenderer:499, TextElementSvg:150, printSlideHtml:60, exportCore legacy
  :276, LinkOverlay:169, elementClipboard:110, fileOps:419.
- Guard test `colorTokenRenderPaths.test.tsx` (like cardRenderPaths): color='accent'
  resolves to theme.accent in editor/present/thumbnail/export(app+CLI)/print/overlay,
  light vs dark; cover boxTint fill; arrow accent. Assert the guard bites.
- Gate + commit.

## Milestone 2 — <ColorControl> component + migrate 5 sites
- `src/lib/colorPalettes.ts`: TEXT_PALETTE (17), FILL_PALETTE (26), ARROW_PALETTE (8),
  TINT_SWATCHES (5). Move out of PropertiesPanel/TextFormatToolbar.
- `src/components/ColorControl.tsx`: presentational; props value/activeTint, palette,
  customPalette, allowNone+noneLabel, allowCustom, tint {kind:'fill'|'accent', theme},
  onNone/onColor/onTint. Emits SEMANTIC events; each site wires its exact writes so
  the characterization net stays green.
- Migrate: text color (accent token via onTint→color:'accent'), text bg (fill tints,
  unchanged writes), arrow (+accent), cover (+fill tint via boxTint), inline toolbar
  (onColor→execCommand). Merge `.tf-color-swatch` into `.prop-color-swatch`.
- Update characterization net for the NEW affordances (accent option, cover tint,
  customPalette+custom-hex now present on bg/arrow). Palette-pin tests switch to the
  canonical 17.
- Gate + commit.

## Milestone 3 — e2e + docs
- Extend an inspector e2e probe: click swatches/tints in the real app, assert field
  writes + that 'accent' renders theme.accent (screenshot). docs/LLM-EDITING bullet
  for the `accent` color token + cover boxTint.
