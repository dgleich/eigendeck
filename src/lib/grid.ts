// Pure helpers for the editor alignment grid (snap-to-grid).
//
// Kept free of any store/preference reads so the rounding is trivially
// unit-testable. The component layer (DraggableBox) supplies the live
// spacing + on/off + bypass state and calls snapToGrid().

/**
 * Round a slide-space coordinate to the nearest multiple of `spacing`.
 *
 * A spacing below 2px (or non-finite) is treated as "no grid" and returns
 * the value unchanged — guards against a 0/1px grid snapping everything to
 * the origin or to every pixel.
 */
export function snapToGrid(value: number, spacing: number): number {
  if (!Number.isFinite(spacing) || spacing < 2) return value;
  return Math.round(value / spacing) * spacing;
}
