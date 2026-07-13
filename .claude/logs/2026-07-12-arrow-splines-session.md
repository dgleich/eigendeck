# Arrow spline handles (#129)

Branch: `feat/arrow-splines` (off `style/unify-buttons`).

Added Inkscape-style cubic-Bézier control handles to arrows so they can curve,
without disturbing straight arrows.

## What

- **Data model** — optional `c1x/c1y/c2x/c2y` on `ArrowElement`. All four present
  → curved; any absent → straight (backward compatible). Persist via the generic
  JSON `data` blob (like `heads`/`opacity`), no schema change.
- **Geometry** — `arrowGeometry()` gained the four control-point params. Curved
  returns `{curved:true, path:"M sx sy C c1x c1y c2x c2y ex ey", triangles}`;
  heads orient to the curve TANGENT at each tip and the stroke is pulled back to
  the head base along that tangent. Straight case is byte-identical (endAng=0 /
  startAng=π reproduce the old inset). `arrowSvgInner` emits `<path>` for curves;
  `arrowBBox` includes the control points in its hull.
- **All 7 render paths** — `describeArrow` threads the control points into
  `arrowGeometry`, so editor / present / thumbnail / HTML export / PDF-print all
  curve through the shared code. `ArrowGlyph` renders `<path>` (group-translate
  offset) for curves; straight arrows keep per-coordinate subtraction so their
  DOM stays byte-identical. LinkOverlay was refactored off its hand-rolled arrow
  math onto the shared `ArrowGlyph` + `arrowBBox` (fixing the known #98 straggler).
  PresentMode's `AnimatedArrow` interpolates control points too (straight↔curved
  and bend transitions animate); its "moved" check now compares control points.
- **Editor** — control handles at c1/c2 with dashed guide lines when selected;
  drag one to bend (materializes both — a cubic needs all four), double-click to
  straighten; the fat hit-target follows the curve.
- **Inspector** — a Shape toggle (Straight / Curved) that bows the arc out
  perpendicular to the chord or clears the control points.
- **Store** — `shiftArrow()` translates control points with the endpoints on
  move; the resync geometry-copy carries them.

## Verification

- tsc clean, `npm run build` clean, 1118 vitest tests pass.
- Unit tests: geometry (partial-controls fallback, cubic path, tangent heads,
  bbox, string renderer), exportCore round-trip (`<path>` + control points
  survive), editor component test (`<path>`, no `<line>`).
- e2e (`arrow-spline-probe.mjs`, gated in run-all): SPLINE_PASS — curved arrow
  renders `<path>` in editor + present + export; Shape=Curved toggle sets control
  points. Screenshots confirmed the curve, tangent-oriented head, and handles.

Not pushed; branch is local.

---

## Continuation (2026-07-13): interior waypoints + a shape-preserving "+ Point"

Extended curved arrows from a single cubic to a **multi-segment** curve that
passes through interior waypoints, then spent real design effort on making
"+ Point" not distort the curve.

### Interior points
- **Data model** — `ArrowElement.points?: Array<{x,y}>` (plain coordinates, **no
  stored handles** — deliberate, see below). `arrowGeometry(...,points)` builds
  `K = [start, ...points, end]` and emits one cubic `C` per segment. End tangents
  still come from the user handles c1/c2 (heads orient exactly as before);
  interior knots get **automatic Catmull-Rom tangents** `T = (next−prev)/6`.
  `arrowBBox` includes the points in its hull.
- **Editor** — each interior point is a draggable dot (`handlePoint`); double-click
  removes it (`removePoint`). Body-drag translates the points with the endpoints
  and c1/c2 (`cae09b9` fixed curved body-drag not moving the controls). No handles
  on interior points — they'd clutter and the user explicitly didn't want them.
- **Delete affordance** — the arrow's `×` moved onto the shared `.el-delete-btn`
  (top-right of the bbox, select/hover) like every other element (`cdb8b54`),
  instead of a hand-placed center button.

### The "+ Point" shape-preservation problem (the interesting bit)
"+ Point" should add a waypoint **without changing the curve**. First attempt
(`b61cf50`) did exact de Casteljau subdivision — correct, but it required storing
per-point in/out handles (`hix/hiy/hox/hoy`). The user rejected baking handles
into interior knots (**"I don't want to bake hox/hoy into the spline!"**) →
reverted (`58d669c`).

The resolution came from a derivative fact the user pointed at: an interior
knot's Catmull-Rom auto-tangent is **always parallel to the chord** between its
neighbours, so the only placement with no kink is the point where the curve's
tangent is **already parallel to that chord**. By the mean value theorem such a
point exists on every segment. So:

1. **Placement** (`04dd2af`) — `arrowInsertPoint()` picks the **longest** segment
   and finds the parallel-tangent point by bisecting the sign-change of
   `cross(C'(t), chord)` nearest the midpoint (fallback = midpoint on a
   near-straight segment; clamp inward by `minGap` if it would crowd a neighbour —
   the only "wiggle" case, and impossible on the first insertion). This fixes the
   knot **direction** exactly.
2. **Handle scaling** (`4b68032`) — placement alone still leaves each half-segment
   carrying a **full-length** c1/c2 (a full handle on a half segment overshoots,
   a 25–50px bulge). Scale the endpoint handle the split touches toward its
   endpoint by the split parameter — the de Casteljau first-level controls
   `lerp(start,c1,t*)` / `lerp(c2,end,t*)` (a halving at t*=0.5). Only the endpoint
   a segment actually touches is scaled; interior-to-interior splits leave c1/c2
   alone.

Result: endpoints **exact**, new-knot direction **exact**, only the interior
tangent *length* approximate. A Hausdorff test confirms the re-fit tracks the
original single cubic within **~5px**. No handles ever stored on interior points.

### Verification
- `arrowInsertPoint` unit tests: null without handles, symmetric bow → apex +
  halved handles, knot-lies-on-curve + clears endpoints, splits-longest-segment,
  Hausdorff re-fit < 5px. tsc + `npm run build` + 21 geometry tests green.
- Still local, unpushed (same feat/html-element stack).
