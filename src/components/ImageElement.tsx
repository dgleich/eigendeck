import { useRef, useState, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open, message } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import type { ImagePosition } from '../types/presentation';

interface DraggableImageProps {
  imagePath: string;
  position?: ImagePosition;
  scale: number;
  onPositionChange: (pos: ImagePosition) => void;
}

export function DraggableImage({
  imagePath,
  position,
  scale,
  onPositionChange,
}: DraggableImageProps) {
  const { projectPath } = usePresentationStore();
  const pos = position || { x: 100, y: 150, width: 700, height: 450 };
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  let src: string | undefined;
  if (imagePath.startsWith('data:')) {
    src = imagePath;
  } else if (projectPath) {
    try {
      src = convertFileSrc(`${projectPath}/${imagePath}`);
    } catch {
      src = `${projectPath}/${imagePath}`;
    }
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        posX: pos.x,
        posY: pos.y,
      };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.x) / scale;
        const dy = (me.clientY - dragStart.current.y) / scale;
        onPositionChange({
          ...pos,
          x: Math.round(dragStart.current.posX + dx),
          y: Math.round(dragStart.current.posY + dy),
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
    [pos, scale, onPositionChange]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: pos.width,
        h: pos.height,
      };

      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - resizeStart.current.x) / scale;
        const dy = (me.clientY - resizeStart.current.y) / scale;
        onPositionChange({
          ...pos,
          width: Math.max(100, Math.round(resizeStart.current.w + dx)),
          height: Math.max(100, Math.round(resizeStart.current.h + dy)),
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
    [pos, scale, onPositionChange]
  );

  if (!src) return null;

  return (
    <div
      className={`image-element ${isDragging ? 'is-dragging' : ''} ${isResizing ? 'is-resizing' : ''}`}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
      <div
        className="resize-handle"
        onPointerDown={handleResizeDown}
      />
    </div>
  );
}

export function AddImageButton() {
  const { currentSlideIndex, updateSlideContent, projectPath } =
    usePresentationStore();

  const handleAddImage = async () => {
    if (!projectPath) {
      await message('Please save or open a project first.', {
        title: 'No Project Open',
        kind: 'info',
      });
      return;
    }

    const selected = await open({
      title: 'Select Image',
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'],
        },
      ],
    });
    if (!selected) return;

    const fullPath = selected as string;
    const imagesDir = `${projectPath}/images`;
    try {
      if (!(await exists(imagesDir))) await mkdir(imagesDir);
    } catch {
      // ok
    }

    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop() || 'image.png';

    if (!fullPath.startsWith(projectPath)) {
      try {
        const data = await readFile(fullPath);
        await writeFile(`${imagesDir}/${fileName}`, data);
      } catch (e) {
        console.error('Failed to copy image:', e);
      }
    }

    const relativePath = fullPath.startsWith(projectPath)
      ? fullPath.slice(projectPath.length + 1)
      : `images/${fileName}`;

    updateSlideContent(currentSlideIndex, {
      image: relativePath,
      imagePosition: { x: 360, y: 200, width: 1200, height: 680 },
    });
  };

  return (
    <button onClick={handleAddImage} title="Add image to slide">
      + Image
    </button>
  );
}

export function RemoveImageButton() {
  const { presentation, currentSlideIndex, updateSlideContent } =
    usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide?.content.image) return null;

  return (
    <button
      onClick={() =>
        updateSlideContent(currentSlideIndex, {
          image: undefined,
          imagePosition: undefined,
        })
      }
      title="Remove image from slide"
    >
      - Image
    </button>
  );
}
