interface BoxEl {
  position: { x: number; y: number; width: number; height: number };
}
type Len = (px: number) => string;

export function coverHtml(
  el: { position: BoxEl['position']; color?: string; boxTint?: string },
  resolvedSlideBg: string,
  len: Len,
  theme?: { background?: string; accent?: string },
): string;

export function arrowSvgHtml(
  el: { x1: number; y1: number; x2: number; y2: number; color?: string; strokeWidth?: number; headSize?: number; heads?: string; opacity?: number },
  opts?: { viewBox?: string; theme?: { accent?: string } },
): string;

export function imageHtml(
  src: string,
  el: BoxEl & { shadow?: boolean; borderRadius?: number; opacity?: number; rotation?: number },
  len: Len,
): string;
