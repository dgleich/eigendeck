# Animated arrows — unification plan (proposed)

> **Status: proposed / pre-implementation.** A design to decide on before building.
> The A1/A2 correctness fixes (points + accent color in `AnimatedArrow`) already
> shipped (commit `ec43880`); this plan is the deeper refactor that stops the class
> of bug from recurring. See also `docs/arrows.md` (the arrow model + invariants)
> and `.claude/skills/editing-slide-elements` (the 7 render paths).

## The problem

Eigendeck renders arrows in several independent paths. Six of them now route through
the **shared descriptor** — `describeArrow(el, theme)` in `elementDescriptor.mjs`
(resolves color incl. the `accent` token + default `#2563eb`, and builds geometry via
`arrowGeometry(...)` including interior `points`) → `ArrowGlyph`. **Path #3, the
present-mode animation wrapper `AnimatedArrow`, does not.** It hand-rolls its own
coordinate interpolation, its own `arrowGeometry(...)` call, and its own color string.

Every arrow feature added since has had to be re-plumbed into `AnimatedArrow` by hand,
and each time one was missed:

- **#98** — `heads` / `opacity` dropped in #3 (and #5/#6/#7).
- **#129** — interior `points` dropped (A1): a curved arrow with a waypoint rendered
  as a plain 2-handle Bézier when linked + moved across slides.
- **#132** — the `accent` color token not resolved (A2): a linked accent arrow painted
  the literal string `"accent"` (stroke `none` → vanished); an uncolored arrow was
  red (`#e53e3e`) here vs blue (`#2563eb`) everywhere else.

This is the #98/#85 drift class: N independent render sites, and #3 is the straggler
that keeps falling behind. The A1/A2 spot-fixes are correct but they patch the
*symptom* — the hand-rolled path will drift again on the next arrow feature.

## Goal

Make animation **reuse the shared renderer**, so it can never drift again: interpolate
the arrow's raw fields into a synthetic arrow, then render *that* through the exact
same `describeArrow` + `ArrowGlyph` every other path uses.

## Design

Two pure functions + a thin rAF wrapper.

1. **`lerpArrow(from, to, t) → ArrowEl`** (pure; `arrowGeometry.mjs` or a new
   `arrowAnim.mjs`):
   - endpoints `x1/y1/x2/y2`: linear interpolate.
   - control handles: interpolate via `effControls` (the 1/3–2/3 chord fallback, so a
     straight↔curved transition tweens smoothly). Emit `c1/c2` on the result **only
     when `to` is curved**, so the synthetic arrow's `curved` flag matches the target.
   - interior `points`: point-for-point lerp when counts are equal; otherwise snap to
     `to.points` (see "Point-count mismatch").
   - `color`, `strokeWidth`, `headSize`, `heads`, `opacity`: copy from `to` (these are
     not tweened today; cross-fading them is a non-goal).

2. **Render through the shared path** — literally the static present-mode arrow case
   applied to the interpolated arrow:
   ```js
   const d = describeArrow(lerpArrow(from, to, t), theme);
   return <ArrowGlyph geo={d.geo} color={d.color} strokeWidth={d.strokeWidth} opacity={d.opacity} />;
   ```
   No hand-rolled geometry or color survives in `AnimatedArrow`.

3. **`AnimatedArrow` shrinks** to a rAF loop that advances `t` 0→1 (easing unchanged)
   and re-renders via step 2. It owns *timing only* — not geometry, not color, not
   per-field lerp scattered inline.

## Point-count mismatch

A point-for-point lerp is undefined when `from` and `to` have different waypoint
counts. Options:

- **(a) Snap to target points for the whole tween** — the current interim. Endpoints
  and handles animate; interior knots jump to their destination. Simple, and the
  common case (same arrow, moved) has equal counts so never hits this.
- **(b) Arc-length resample** both polylines to `max(count)` before lerp — smooth, more
  code.
- **(c) Add/remove** — hold surplus points at their nearest endpoint so they slide in/out.

**Recommend (a) now**, revisit with (b) only if a real deck makes it look wrong. Whatever
we pick, `lerpArrow` documents it in one place instead of the choice being implicit.

## The `moved` predicate

Today `PresentMode` decides animate-vs-static with a hand-listed field comparison that
(before this review) omitted `points`. Replace it with `!arrowsEqual(from, to)` over the
**same field set `lerpArrow` reads** — so the "what counts as a change" list can never
again drift from the "what gets interpolated" list.

## What this buys

- A1 / A2 / #98 can't regress in #3 again — a single renderer, not a parallel one.
- Deletes ~30 lines of hand-rolled geometry + color from `PresentMode`.
- The parity guarantee becomes testable directly (below).

## Testing

- **Unit** (`lerpArrow`): `t=0` → from-shape, `t=1` → to-shape; a midpoint curve passes
  near the expected point; the count-mismatch branch returns `to.points`.
- **Parity** (the key test): `AnimatedArrow` at `t=1` renders **byte-identical** to the
  static `PresentSlide` arrow, across a matrix — straight, curved, curved+points,
  `accent` color, default color, each `heads` value, with/without `opacity`. This is the
  regression net that makes future drift impossible to merge.
- The interim A1/A2 tests already added stay.

## Scope / non-goals

- Not touching the transition planner or timing/easing.
- Not cross-fading `heads`/`strokeWidth`/color mid-tween.
- Point-resampling (option b) deferred.

## Migration

One small, mechanical, low-risk commit: add `lerpArrow` + `arrowsEqual`, rewrite
`AnimatedArrow` to the thin wrapper, swap the `moved` check, add the parity test.
Behavior-preserving for the common case; strictly more correct for curved+points and
accent (which the interim already fixed — this makes it structural).
