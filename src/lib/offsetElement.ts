import type { SlideElement } from '../types/presentation';

/**
 * Shift an element by (dx, dy) IN PLACE — arrows move their four endpoint
 * coords, every other type moves its position box. Used when dropping a
 * duplicate/paste on the same slide so the copy doesn't stack exactly on top.
 */
export function offsetElement(el: SlideElement, dx: number, dy: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = el as any;
  if (e.type === 'arrow') {
    e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy;
  } else {
    e.position = { ...e.position, x: e.position.x + dx, y: e.position.y + dy };
  }
}
