export interface ElementBox { x: number; y: number; width: number; height: number; }

export interface CoverDescriptor {
  kind: 'cover';
  box: ElementBox;
  background: string;
}

export function describeCover(
  el: { position: ElementBox; color?: string },
  resolvedSlideBg: string,
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
