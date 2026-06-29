/** Clamp a number to the [0, 1] range. Shared by the present/speaker focal-point
 *  math (mapping a cursor position to a normalized slide coordinate). */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
