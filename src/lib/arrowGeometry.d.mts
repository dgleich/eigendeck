
export type ArrowHeads = 'end' | 'start' | 'both' | 'none';

export interface ArrowGeo {
  /** Present for a straight arrow. */
  line?: { x1: number; y1: number; x2: number; y2: number };
  /** Present for a curved arrow (#129): an SVG cubic-Bézier path `M .. C .. .. ..`. */
  path?: string;
  curved?: boolean;
  triangles: number[][][];
}

export interface ArrowPoint {
  x: number; y: number;
  /** Explicit in/out control handles (exact "+ Point" subdivision). */
  hix?: number; hiy?: number; hox?: number; hoy?: number;
}

export function arrowGeometry(
  x1: number, y1: number, x2: number, y2: number, headSize: number, heads?: ArrowHeads,
  c1x?: number, c1y?: number, c2x?: number, c2y?: number, points?: ArrowPoint[],
): ArrowGeo;

export function triPoints(t: number[][]): string;

export function arrowInsertPoint(
  x1: number, y1: number, x2: number, y2: number,
  c1x: number, c1y: number, c2x: number, c2y: number, points?: ArrowPoint[],
): { c1x: number; c1y: number; c2x: number; c2y: number; points: ArrowPoint[] };

export function arrowSvgInner(
  geo: ArrowGeo, color: string, strokeWidth: number, opacity?: number,
): string;

export function arrowBBox(
  x1: number, y1: number, x2: number, y2: number,
  headSize: number, heads?: ArrowHeads, pad?: number,
  c1x?: number, c1y?: number, c2x?: number, c2y?: number, points?: ArrowPoint[],
): { minX: number; minY: number; maxX: number; maxY: number };
