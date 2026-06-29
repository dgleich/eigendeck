import type { CSSProperties } from 'react';

/**
 * The optional visual styles an image element carries — drop shadow, border
 * radius, opacity, rotation. Shared by the editor and present render paths,
 * which built this identical conditional-spread block. Returns only the props
 * that apply (so spreading it is a no-op when none are set), to be merged after
 * the path's base layout style.
 */
export function imageVisualStyle(
  el: { shadow?: boolean; borderRadius?: number; opacity?: number; rotation?: number },
): CSSProperties {
  return {
    ...(el.shadow ? { filter: 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))' } : {}),
    ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
    ...(el.opacity != null && el.opacity < 1 ? { opacity: el.opacity } : {}),
    ...(el.rotation ? { transform: `rotate(${el.rotation}deg)` } : {}),
  };
}
