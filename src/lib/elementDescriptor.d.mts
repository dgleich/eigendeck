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
