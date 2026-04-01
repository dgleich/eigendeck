import { useRef, useState, useCallback, useEffect } from 'react';
import type { TextBox } from '../types/presentation';

interface TextBoxElementProps {
  textBox: TextBox;
  scale: number;
  onUpdate: (id: string, changes: Partial<TextBox>) => void;
  onDelete: (id: string) => void;
}

export function TextBoxElement({
  textBox,
  scale,
  onUpdate,
  onDelete,
}: TextBoxElementProps) {
  const { id, html, position: pos } = textBox;
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Sync HTML content
  useEffect(() => {
    if (contentRef.current && !isEditing) {
      contentRef.current.innerHTML = html;
    }
  }, [html, isEditing]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return;
      if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
      if ((e.target as HTMLElement).classList.contains('delete-btn')) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.x) / scale;
        const dy = (me.clientY - dragStart.current.y) / scale;
        onUpdate(id, {
          position: {
            ...pos,
            x: Math.round(dragStart.current.posX + dx),
            y: Math.round(dragStart.current.posY + dy),
          },
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
    [id, pos, scale, isEditing, onUpdate]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStart.current = { x: e.clientX, y: e.clientY, w: pos.width, h: pos.height };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - resizeStart.current.x) / scale;
        const dy = (me.clientY - resizeStart.current.y) / scale;
        onUpdate(id, {
          position: {
            ...pos,
            width: Math.max(100, Math.round(resizeStart.current.w + dx)),
            height: Math.max(50, Math.round(resizeStart.current.h + dy)),
          },
        });
      };

      const handleUp = () => {
        setIsResizing(false);
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [id, pos, scale, onUpdate]
  );

  const handleDoubleClick = () => {
    setIsEditing(true);
    setTimeout(() => contentRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (contentRef.current) {
      onUpdate(id, { html: contentRef.current.innerHTML });
    }
  };

  return (
    <div
      className={`textbox-element ${isDragging ? 'is-dragging' : ''} ${isEditing ? 'is-editing' : ''} ${isResizing ? 'is-resizing' : ''}`}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
        cursor: isEditing ? 'text' : isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={contentRef}
        className="textbox-content"
        contentEditable={isEditing}
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setIsEditing(false);
            handleBlur();
          }
          // Stop propagation so keyboard shortcuts don't fire while editing
          e.stopPropagation();
        }}
      />
      {!isEditing && (
        <>
          <button
            className="delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            title="Delete text box"
          >
            ×
          </button>
          <div className="resize-handle" onPointerDown={handleResizeDown} />
        </>
      )}
    </div>
  );
}
