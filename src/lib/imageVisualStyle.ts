import type { CSSProperties } from 'react';
import { imageVisuals } from './elementDescriptor.mjs';

/**
 * The optional visual styles an image element carries — drop shadow, border
 * radius, opacity, rotation — as a React style object. The predicates + magic
 * values live once in `imageVisuals` (the descriptor, shared with the HTML
 * export); this is the React-form adapter. Returns only the props that apply (so
 * spreading it is a no-op when none are set), to be merged after the path's base
 * layout style.
 */
export function imageVisualStyle(
  el: { shadow?: boolean; borderRadius?: number; opacity?: number; rotation?: number },
): CSSProperties {
  const v = imageVisuals(el);
  return {
    ...(v.shadow ? { filter: v.shadow } : {}),
    ...(v.borderRadius ? { borderRadius: v.borderRadius } : {}),
    ...(v.opacity != null ? { opacity: v.opacity } : {}),
    ...(v.transform ? { transform: v.transform } : {}),
  };
}
