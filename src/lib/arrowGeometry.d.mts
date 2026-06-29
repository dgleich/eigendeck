
export type ArrowHeads = 'end' | 'start' | 'both' | 'none';

export function arrowGeometry(
  x1: number, y1: number, x2: number, y2: number, headSize: number, heads?: ArrowHeads,
): {
  line: { x1: number; y1: number; x2: number; y2: number };
  triangles: number[][][];
};

export function triPoints(t: number[][]): string;

export function arrowBBox(
  x1: number, y1: number, x2: number, y2: number,
  headSize: number, heads?: ArrowHeads, pad?: number,
): { minX: number; minY: number; maxX: number; maxY: number };
