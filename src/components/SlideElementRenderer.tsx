import { useRef, useState, useCallback, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { SlideElement, ElementPosition } from '../types/presentation';

interface Props {
  element: SlideElement;
  zIndex: number;
  scale: number;
  projectPath: string | null;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void;
  onSelect: () => void;
}

export function SlideElementRenderer({
  element,
  zIndex,
  scale,
  projectPath,
  onUpdate,
  onDelete,
  onSelect,
}: Props) {
  switch (element.type) {
    case 'title':
      return (
        <DraggableBox
          position={element.position}
          zIndex={zIndex}
          scale={scale}
          className="el-title"
          onSelect={onSelect}
          onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
        >
          <EditableText
            text={element.text}
            style={{ fontSize: element.fontSize || 56 }}
            className="el-title-text"
            onCommit={(text) => onUpdate({ text } as any)}
          />
        </DraggableBox>
      );

    case 'textBox':
      return (
        <DraggableBox
          position={element.position}
          zIndex={zIndex}
          scale={scale}
          className="el-textbox"
          onSelect={onSelect}
          onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
        >
          <EditableHtml
            html={element.html}
            className="el-textbox-content"
            onCommit={(html) => onUpdate({ html } as any)}
          />
        </DraggableBox>
      );

    case 'image': {
      let src: string;
      if (element.src.startsWith('data:')) {
        src = element.src;
      } else if (projectPath) {
        try { src = convertFileSrc(`${projectPath}/${element.src}`); }
        catch { src = element.src; }
      } else {
        src = element.src;
      }
      return (
        <DraggableBox
          position={element.position}
          zIndex={zIndex}
          scale={scale}
          className="el-image"
          onSelect={onSelect}
          onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
        >
          <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        </DraggableBox>
      );
    }

    case 'demo': {
      let src: string | undefined;
      if (projectPath) {
        try { src = convertFileSrc(`${projectPath}/${element.src}`); }
        catch { src = undefined; }
      }
      return (
        <DraggableBox
          position={element.position}
          zIndex={zIndex}
          scale={scale}
          className="el-demo"
          onSelect={onSelect}
          onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
        >
          {src && (
            <iframe src={src} sandbox="allow-scripts allow-same-origin" title="demo"
              style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </DraggableBox>
      );
    }

    case 'arrow':
      return (
        <ArrowRenderer
          element={element}
          zIndex={zIndex}
          scale={scale}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onSelect={onSelect}
        />
      );
  }
}

// ============================================
// Draggable + resizable box (shared by most element types)
// ============================================
function DraggableBox({
  position: pos,
  zIndex,
  scale,
  className,
  children,
  onSelect,
  onDelete,
  onPositionChange,
}: {
  position: ElementPosition;
  zIndex: number;
  scale: number;
  className: string;
  children: React.ReactNode;
  onSelect: () => void;
  onDelete: () => void;
  onPositionChange: (pos: ElementPosition) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.el-resize-handle, .el-delete-btn, input, [contenteditable="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };

      const handleMove = (me: PointerEvent) => {
        onPositionChange({
          ...pos,
          x: Math.round(dragStart.current.posX + (me.clientX - dragStart.current.x) / scale),
          y: Math.round(dragStart.current.posY + (me.clientY - dragStart.current.y) / scale),
        });
      };
      const handleUp = () => {
        setIsDragging(false);
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [pos, scale, onSelect, onPositionChange]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: pos.width, h: pos.height };
      const handleMove = (me: PointerEvent) => {
        onPositionChange({
          ...pos,
          width: Math.max(50, Math.round(resizeStart.current.w + (me.clientX - resizeStart.current.x) / scale)),
          height: Math.max(30, Math.round(resizeStart.current.h + (me.clientY - resizeStart.current.y) / scale)),
        });
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [pos, scale, onPositionChange]
  );

  return (
    <div
      className={`slide-element ${className} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
        zIndex,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {children}
      <button className="el-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
      <div className="el-resize-handle" onPointerDown={handleResizeDown} />
    </div>
  );
}

// ============================================
// Editable text (for titles)
// ============================================
function EditableText({
  text,
  style,
  className,
  onCommit,
}: {
  text: string;
  style?: React.CSSProperties;
  className?: string;
  onCommit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`el-inline-input ${className || ''}`}
        defaultValue={text}
        style={style}
        onBlur={(e) => { onCommit(e.currentTarget.value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onCommit(e.currentTarget.value); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }

  return (
    <div className={className} style={style} onDoubleClick={() => setEditing(true)}>
      {text}
    </div>
  );
}

// ============================================
// Editable HTML (for text boxes)
// ============================================
function EditableHtml({
  html,
  className,
  onCommit,
}: {
  html: string;
  className?: string;
  onCommit: (html: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current && !editing) {
      contentRef.current.innerHTML = html;
    }
  }, [html, editing]);

  return (
    <div
      ref={contentRef}
      className={className}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={() => { setEditing(true); setTimeout(() => contentRef.current?.focus(), 0); }}
      onBlur={() => { if (contentRef.current) onCommit(contentRef.current.innerHTML); setEditing(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { if (contentRef.current) onCommit(contentRef.current.innerHTML); setEditing(false); } e.stopPropagation(); }}
      style={editing ? { cursor: 'text', outline: 'none' } : {}}
    />
  );
}

// ============================================
// Arrow renderer with draggable endpoints
// ============================================
function ArrowRenderer({
  element: a,
  zIndex,
  scale,
  onUpdate,
  onDelete,
  onSelect,
}: {
  element: Extract<SlideElement, { type: 'arrow' }>;
  zIndex: number;
  scale: number;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = a;
  const dragStart = useRef({ mx: 0, my: 0, ox1: 0, oy1: 0, ox2: 0, oy2: 0 });

  const handleEndpoint = useCallback(
    (e: React.PointerEvent, which: 'start' | 'end') => {
      e.preventDefault(); e.stopPropagation(); onSelect();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        if (which === 'start') onUpdate({ x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy) } as any);
        else onUpdate({ x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy) } as any);
      };
      const handleUp = () => { window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, scale, onUpdate, onSelect]
  );

  const handleBody = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); onSelect();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        onUpdate({
          x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy),
          x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy),
        } as any);
      };
      const handleUp = () => { window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, scale, onUpdate, onSelect]
  );

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ha = Math.PI / 6;
  const hx1 = x2 - headSize * Math.cos(angle - ha);
  const hy1 = y2 - headSize * Math.sin(angle - ha);
  const hx2 = x2 - headSize * Math.cos(angle + ha);
  const hy2 = y2 - headSize * Math.sin(angle + ha);

  const pad = 30;
  const minX = Math.min(x1, x2, hx1, hx2) - pad;
  const minY = Math.min(y1, y2, hy1, hy2) - pad;
  const maxX = Math.max(x1, x2, hx1, hx2) + pad;
  const maxY = Math.max(y1, y2, hy1, hy2) + pad;

  return (
    <div
      className="slide-element el-arrow"
      style={{ position: 'absolute', left: minX, top: minY, width: maxX - minX, height: maxY - minY, pointerEvents: 'none', zIndex }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <svg width={maxX - minX} height={maxY - minY} style={{ overflow: 'visible' }}>
        <line x1={x1 - minX} y1={y1 - minY} x2={x2 - minX} y2={y2 - minY}
          stroke="transparent" strokeWidth={20} style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={handleBody} />
        <line x1={x1 - minX} y1={y1 - minY} x2={x2 - minX} y2={y2 - minY}
          stroke={color} strokeWidth={strokeWidth} style={{ pointerEvents: 'none' }} />
        <polygon points={`${x2 - minX},${y2 - minY} ${hx1 - minX},${hy1 - minY} ${hx2 - minX},${hy2 - minY}`}
          fill={color} style={{ pointerEvents: 'none' }} />
        <circle cx={x1 - minX} cy={y1 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'start')} />
        <circle cx={x2 - minX} cy={y2 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'end')} />
      </svg>
      <button className="el-delete-btn" style={{ position: 'absolute', left: (x1 + x2) / 2 - minX - 10, top: (y1 + y2) / 2 - minY - 10, pointerEvents: 'all' }}
        onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
    </div>
  );
}
