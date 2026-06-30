import type { CSSProperties } from 'react';
import { arrowGeometry } from '../lib/arrowGeometry.mjs';

type ArrowGeo = ReturnType<typeof arrowGeometry>;

/**
 * The inner SVG of an arrow — the inset line + head triangle(s) wrapped in a
 * `<g opacity>`. Shared by the three React render paths (editor canvas,
 * present/projector, sidebar thumbnail) which all built this identically; each
 * still supplies its own `<svg>` wrapper. `dx`/`dy` translate into a
 * bbox-relative coordinate space (the editor draws in a padded box); they
 * default to 0 (absolute coords) for the present/thumbnail paths.
 */
export function ArrowGlyph({ geo, color, strokeWidth, opacity, dx = 0, dy = 0, gStyle }: {
  geo: ArrowGeo;
  color: string;
  strokeWidth: number;
  opacity?: number;
  dx?: number;
  dy?: number;
  gStyle?: CSSProperties;
}) {
  return (
    <g opacity={opacity ?? 1} style={gStyle}>
      <line x1={geo.line.x1 - dx} y1={geo.line.y1 - dy} x2={geo.line.x2 - dx} y2={geo.line.y2 - dy} stroke={color} strokeWidth={strokeWidth} />
      {geo.triangles.map((t, i) => (
        <polygon key={i} points={t.map((p) => `${p[0] - dx},${p[1] - dy}`).join(' ')} fill={color} />
      ))}
    </g>
  );
}
