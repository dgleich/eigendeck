import type { CSSProperties } from 'react';
import type { ElementBox } from '../lib/elementDescriptor.mjs';

/**
 * React adapter for the unified element-descriptor path: paints a descriptor as
 * a React node. The HTML-string targets (exportCore / printToPdf) have their own
 * adapter. `extraStyle` carries per-target wrapper bits (e.g. present-mode
 * zIndex + transition style). The editor wraps cover in its own DraggableBox, so
 * it consumes the descriptor's value rather than this absolute-positioned view.
 */
export function CoverView({ box, background, extraStyle }: {
  box: ElementBox;
  background: string;
  extraStyle?: CSSProperties;
}) {
  return (
    <div style={{
      position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height,
      background,
      ...extraStyle,
    }} />
  );
}
