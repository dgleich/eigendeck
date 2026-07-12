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
