import { useRef, useState, useCallback } from 'react';
import type { Arrow } from '../types/presentation';

interface ArrowElementProps {
  arrow: Arrow;
  scale: number;
  onUpdate: (id: string, changes: Partial<Arrow>) => void;
  onDelete: (id: string) => void;
}

export function ArrowElement({
  arrow,
  scale,
  onUpdate,
  onDelete,
}: ArrowElementProps) {
  const { id, x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = arrow;
  const [, setDraggingEnd] = useState<'start' | 'end' | 'body' | null>(null);
  const dragStart = useRef({ mx: 0, my: 0, ox1: 0, oy1: 0, ox2: 0, oy2: 0 });

  const handleEndpointDown = useCallback(
    (e: React.PointerEvent, which: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingEnd(which);
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        if (which === 'start') {
          onUpdate(id, { x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy) });
        } else {
          onUpdate(id, { x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy) });
        }
      };

      const handleUp = () => {
        setDraggingEnd(null);
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [id, x1, y1, x2, y2, scale, onUpdate]
  );

  const handleBodyDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingEnd('body');
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        onUpdate(id, {
          x1: Math.round(dragStart.current.ox1 + dx),
          y1: Math.round(dragStart.current.oy1 + dy),
          x2: Math.round(dragStart.current.ox2 + dx),
          y2: Math.round(dragStart.current.oy2 + dy),
        });
      };

      const handleUp = () => {
        setDraggingEnd(null);
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [id, x1, y1, x2, y2, scale, onUpdate]
  );

  // Calculate arrowhead points
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headAngle = Math.PI / 6;
  const hx1 = x2 - headSize * Math.cos(angle - headAngle);
  const hy1 = y2 - headSize * Math.sin(angle - headAngle);
  const hx2 = x2 - headSize * Math.cos(angle + headAngle);
  const hy2 = y2 - headSize * Math.sin(angle + headAngle);

  // Bounding box for SVG
  const pad = 30;
  const minX = Math.min(x1, x2, hx1, hx2) - pad;
  const minY = Math.min(y1, y2, hy1, hy2) - pad;
  const maxX = Math.max(x1, x2, hx1, hx2) + pad;
  const maxY = Math.max(y1, y2, hy1, hy2) + pad;

  return (
    <div
      className="arrow-element"
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={maxX - minX}
        height={maxY - minY}
        style={{ overflow: 'visible' }}
      >
        {/* Invisible thick line for easier clicking */}
        <line
          x1={x1 - minX}
          y1={y1 - minY}
          x2={x2 - minX}
          y2={y2 - minY}
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
          onPointerDown={handleBodyDown}
        />
        {/* Visible arrow line */}
        <line
          x1={x1 - minX}
          y1={y1 - minY}
          x2={x2 - minX}
          y2={y2 - minY}
          stroke={color}
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
        {/* Arrowhead */}
        <polygon
          points={`${x2 - minX},${y2 - minY} ${hx1 - minX},${hy1 - minY} ${hx2 - minX},${hy2 - minY}`}
          fill={color}
          style={{ pointerEvents: 'none' }}
        />
        {/* Start endpoint handle */}
        <circle
          cx={x1 - minX}
          cy={y1 - minY}
          r={8}
          fill="#fff"
          stroke={color}
          strokeWidth={2}
          className="arrow-handle"
          style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpointDown(e, 'start')}
        />
        {/* End endpoint handle */}
        <circle
          cx={x2 - minX}
          cy={y2 - minY}
          r={8}
          fill="#fff"
          stroke={color}
          strokeWidth={2}
          className="arrow-handle"
          style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpointDown(e, 'end')}
        />
      </svg>
      {/* Delete button near midpoint */}
      <button
        className="arrow-delete-btn"
        style={{
          position: 'absolute',
          left: (x1 + x2) / 2 - minX - 10,
          top: (y1 + y2) / 2 - minY - 10,
          pointerEvents: 'all',
        }}
        onClick={() => onDelete(id)}
        title="Delete arrow"
      >
        ×
      </button>
    </div>
  );
}

/** Static arrow for present mode / export (no handles) */
export function ArrowStatic({ arrow }: { arrow: Arrow }) {
  const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = arrow;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headAngle = Math.PI / 6;
  const hx1 = x2 - headSize * Math.cos(angle - headAngle);
  const hy1 = y2 - headSize * Math.sin(angle - headAngle);
  const hx2 = x2 - headSize * Math.cos(angle + headAngle);
  const hy2 = y2 - headSize * Math.sin(angle + headAngle);

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
      <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={color} />
    </svg>
  );
}
