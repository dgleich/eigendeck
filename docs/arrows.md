# Arrows

The `arrow` element is a straight or curved SVG arrow with optional heads. Its
geometry is centralized in **`src/lib/arrowGeometry.mjs`** so every render path
(editor, present, thumbnail, HTML export, PDF/print, link overlay) draws the same
shape and never drifts.

## Data model (`ArrowElement`)

Unlike most elements, an arrow has **no `position` box** — it's defined by two
endpoints in slide space (1920×1080):

| Field | Meaning |
|-------|---------|
| `x1, y1` / `x2, y2` | start / end points (slide px) |
| `color` | stroke + head fill (default varies; real arrows carry an explicit color) |
| `strokeWidth` | stroke width (default 4) |
| `headSize` | arrowhead size (default 16) |
| `heads` | `'end'` (default) \| `'start'` \| `'both'` \| `'none'` |
| `opacity` | 0–1 (default 1) |
| `c1x, c1y` / `c2x, c2y` | **endpoint Bézier tangent handles** — `c1` off the start, `c2` off the end |
| `points[]` | interior waypoints `{x,y}` the curve passes through (no handles) |

`x1/y1/x2/y2`, `c1/c2`, and `points` are all in raw slide coordinates (not
relative to a box), so the store special-cases arrows in move/translate/z-order
and the resync geometry copy.

## The three shapes

1. **Straight** — `c1/c2` absent → a line from start to end.
2. **Curved (two-handle Bézier)** — all four `c1/c2` present, no `points` → a
   single cubic: `M x1 y1 C c1x c1y c2x c2y x2 y2`. This is the Inkscape-style
   two-handle curve the user shapes directly.
3. **Curved with waypoints** — `c1/c2` present **and** `points[]` non-empty → a
   **multi-segment cubic Bézier spline** through `[start, …points, end]`, one
   cubic `C` per segment.

`points` only apply when the arrow is curved (they need the `c1/c2` handles for
the end segments).

## The curve is a cubic Bézier spline (C¹)

The rendered path is always cubic Bézier segments. How the per-segment control
points are chosen:

- **Endpoints — from the user handles.** The start segment's outgoing control is
  `c1`; the end segment's incoming control is `c2`. So the two ends' tangent
  **direction and magnitude are exactly what the user set** with the handles.
- **Interior knots — Catmull-Rom auto-tangents.** Each interior knot `i` gets a
  tangent `T = (K[i+1] − K[i−1]) / 2`, i.e. Bézier controls `K[i] ± (K[i+1] −
  K[i−1])/6`. This is **C¹**: the tangent is continuous across every interior
  knot, but the curvature (2nd derivative) may change. Interior knots carry **no
  stored handles** — they're on-curve dots only.

### Why C¹ Catmull-Rom, not a C² spline

A true C² interpolating spline (clamped cubic) would make the curvature continuous
too, and could be clamped to the `c1/c2` end tangents. It was considered and
**declined** on purpose: Catmull-Rom is **local** (dragging or adding one point
only affects its neighbouring segments), more **predictable** in an interactive
editor, and **hugs the points** (less overshoot). A C² spline is a global solve —
moving one point ripples through the whole curve and can overshoot. For arrows
(usually 1–3 waypoints) the visual difference is small and locality wins.

## INVARIANT: the endpoints always have tangent handles

**A curved arrow ALWAYS exposes its two endpoint tangent handles (`c1`/`c2`).**
They are draggable in the editor, define the end tangent direction + magnitude,
and orient the arrowheads. This is a hard product requirement:

- Never derive the endpoint tangents from the neighbouring knot (that would be a
  handle-less, Catmull-Rom endpoint) — the ends must stay hand-tunable.
- Never hide the `c1/c2` handles because interior `points` exist — both the
  endpoint handles **and** the interior dots are shown together.
- Adding/removing an interior point must leave `c1/c2` untouched.

Only the **interior** knots are handle-less (auto-smoothed).

## Heads and the inset

The arrowhead at each end points along the **curve tangent** there:

- `endAng` = direction `c2 → end` (curved) or `start → end` (straight).
- `startAng` = direction `c1 → start` (curved, pointing outward) or `end → start`
  (straight).

The stroke endpoint is pulled back to the **head base** along that tangent (inset
= `headSize · cos 30°`) so the line meets the head cleanly instead of poking
through the tip. On an arrow shorter than the combined insets the inset is clamped
by the straight-line length so the stroke never reverses.

## "+ Point" (adding a waypoint)

`arrowInsertPoint()` inserts a new waypoint **on the current curve, at the
midpoint (t = 0.5) of the longest segment**, so it doesn't jump. Then the arrow
**re-smooths** (interior Catmull-Rom) — the shape is allowed to change; there is
no shape-preservation or handle-scaling, and the `c1/c2` handles are left
**unchanged**. A straight arrow first materialises `c1/c2` on the line (so it
gains the required endpoint handles) and stays straight until a knot is dragged.

Remove a waypoint by double-clicking its dot; removing the last one returns the
arrow to a two-handle curve (or straight, if the handles are cleared).

## Editor interaction (`SlideElementRenderer.tsx` → `ArrowRenderer`)

- **Endpoints** — draggable move handles (crosshair cursor).
- **`c1`/`c2` handles** — draggable dots with dashed guide lines from each
  endpoint; double-click a handle to **straighten** (clears `c1/c2` **and**
  `points`).
- **Interior points** — on-curve dots; drag to route, double-click to remove.
- **Body drag** — translates endpoints, `c1/c2`, and `points` together (so the
  whole curve moves without warping).
- **Inspector Shape section** (`PropertiesPanel.tsx`) — `Straight` / `Curved` /
  `+ Point`. `Curved` bows the arc out perpendicular to the chord; `Straight`
  clears the handles + points.

## Render paths & files

Arrow geometry flows from one place so the 7 render/output modes match (see
`docs/ELEMENT-CHECKLIST.md`). `describeArrow()` (`src/lib/elementDescriptor.mjs`)
resolves color/width/heads and calls `arrowGeometry`; the JSX targets draw it via
`ArrowGlyph`, the string targets (HTML export, PDF/print) via `arrowSvgInner`
(SVG-string). `arrowBBox` gives the padded hit area / bounding box, including the
`c1/c2` control points and `points` in its hull.

- `src/lib/arrowGeometry.mjs` (+ `.d.mts`, `.test.mjs`) — geometry: endpoints +
  head triangles + inset; the cubic-Bézier-spline path; `arrowInsertPoint`;
  `arrowSvgInner`; `arrowBBox`.
- `src/lib/elementDescriptor.mjs` — `describeArrow` (shared defaults).
- `src/components/SlideElementRenderer.tsx` — editor `ArrowRenderer` + handles.
- `src/components/PresentSlide.tsx`, `SlideThumbnail.tsx`, `LinkOverlay.tsx`,
  `PresentMode.tsx` (`AnimatedArrow`) — the other render paths (present /
  thumbnail / link overlay / transition animation).
- `src/lib/exportCore.mjs`, `src/lib/printSlideHtml.ts` — HTML export / PDF print
  (string targets).
