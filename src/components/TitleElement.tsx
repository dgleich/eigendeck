import { useRef, useState, useCallback, useEffect } from 'react';
import type { SlideTitle } from '../types/presentation';

interface TitleElementProps {
  title: SlideTitle;
  scale: number;
  onUpdate: (changes: Partial<SlideTitle>) => void;
}

export function TitleElement({ title, scale, onUpdate }: TitleElementProps) {
  const { text, position: pos, fontSize = 56 } = title;
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.x) / scale;
        const dy = (me.clientY - dragStart.current.y) / scale;
        onUpdate({
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
    [pos, scale, isEditing, onUpdate]
  );

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const finishEditing = () => {
    setIsEditing(false);
    if (inputRef.current) {
      onUpdate({ text: inputRef.current.value });
    }
  };

  return (
    <div
      className={`title-element ${isDragging ? 'is-dragging' : ''} ${isEditing ? 'is-editing' : ''}`}
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
      {isEditing ? (
        <input
          ref={inputRef}
          className="title-input-inline"
          defaultValue={text}
          style={{ fontSize }}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishEditing();
            if (e.key === 'Escape') {
              setIsEditing(false);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <div
          className="title-text"
          style={{ fontSize }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
