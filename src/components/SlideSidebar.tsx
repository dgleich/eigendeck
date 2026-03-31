import { useRef, useState } from 'react';
import { usePresentationStore } from '../store/presentation';

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;
const THUMB_WIDTH = 156;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE;

export function SlideSidebar() {
  const {
    presentation,
    currentSlideIndex,
    selectSlide,
    addSlide,
    deleteSlide,
    duplicateSlide,
    moveSlide,
  } = usePresentationStore();

  const dragItem = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image semi-transparent
    const el = e.currentTarget as HTMLElement;
    el.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    setDragOverIndex(null);
    dragItem.current = null;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragItem.current !== null && dragItem.current !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragItem.current !== null && dragItem.current !== dropIndex) {
      moveSlide(dragItem.current, dropIndex);
    }
    dragItem.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-slides">
        {presentation.slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`slide-thumbnail${index === currentSlideIndex ? ' active' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
            onClick={() => selectSlide(index)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
          >
            <span className="slide-number">{index + 1}</span>
            <div
              className="slide-thumb-clip"
              style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
            >
              <div
                className="slide-thumb-render slide-content-styles"
                style={{
                  width: SLIDE_WIDTH,
                  height: SLIDE_HEIGHT,
                  transform: `scale(${THUMB_SCALE})`,
                  transformOrigin: 'top left',
                }}
                dangerouslySetInnerHTML={{
                  __html: slide.content.html || '<p>Empty</p>',
                }}
              />
            </div>
            <div className="slide-actions">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateSlide(index);
                }}
                title="Duplicate"
              >
                D
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    presentation.slides.length > 1 &&
                    confirm('Delete this slide?')
                  ) {
                    deleteSlide(index);
                  }
                }}
                title="Delete"
              >
                X
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn-add-slide" onClick={addSlide}>
        + Add Slide
      </button>
    </div>
  );
}
