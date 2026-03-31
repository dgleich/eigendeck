import { useRef } from 'react';
import { usePresentationStore } from '../store/presentation';

const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 700;
const THUMB_WIDTH = 156; // sidebar width minus padding
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
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverItem.current = index;
  };

  const handleDrop = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      moveSlide(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  return (
    <div className="sidebar">
      <div className="sidebar-slides">
        {presentation.slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`slide-thumbnail ${index === currentSlideIndex ? 'active' : ''}`}
            onClick={() => selectSlide(index)}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
            style={{ height: THUMB_HEIGHT + 24 }}
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
