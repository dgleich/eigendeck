export interface ElementBox { x: number; y: number; width: number; height: number; }

export interface CoverDescriptor {
  kind: 'cover';
  box: ElementBox;
  background: string;
}

export function describeCover(
  el: { position: ElementBox; color?: string; boxTint?: string },
  resolvedSlideBg: string,
  theme?: { background?: string; accent?: string },
): CoverDescriptor;

export interface ImageVisuals {
  shadow?: string;
  borderRadius?: number;
  opacity?: number;
  transform?: string;
}

export function imageVisuals(
  el: { shadow?: boolean; borderRadius?: number; opacity?: number; rotation?: number },
): ImageVisuals;

export interface ArrowDescriptor {
  kind: 'arrow';
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  strokeWidth: number;
  headSize: number;
  heads?: 'start' | 'end' | 'both' | 'none';
  opacity?: number;
  geo: ReturnType<typeof import('./arrowGeometry.mjs').arrowGeometry>;
}

export function describeArrow(
  el: {
    x1: number; y1: number; x2: number; y2: number;
    color?: string; strokeWidth?: number; headSize?: number;
    heads?: 'start' | 'end' | 'both' | 'none'; opacity?: number;
  },
  theme?: { accent?: string },
): ArrowDescriptor;
