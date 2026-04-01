import { useRef, useState, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;
const THUMB_WIDTH = 166;
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

  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  const handleContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging === null) return;
      const thumbs = containerRef.current?.querySelectorAll('.slide-thumbnail');
      if (!thumbs) return;
      let found = false;
      for (let i = 0; i < thumbs.length; i++) {
        const rect = thumbs[i].getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom && i !== dragging) {
          setDropTarget(i); found = true; break;
        }
      }
      if (!found) setDropTarget(null);
    },
    [dragging]
  );

  const handleContainerPointerUp = useCallback(() => {
    if (dragging !== null && dropTarget !== null && dragging !== dropTarget) moveSlide(dragging, dropTarget);
    setDragging(null); setDropTarget(null);
  }, [dragging, dropTarget, moveSlide]);

  return (
    <div className="sidebar">
      <div
        className={`sidebar-slides${dragging !== null ? ' is-dragging' : ''}`}
        ref={containerRef}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        onPointerLeave={() => { if (dragging !== null) { setDragging(null); setDropTarget(null); } }}
      >
        {presentation.slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`slide-thumbnail${index === currentSlideIndex ? ' active' : ''}${dropTarget === index ? ' drag-over' : ''}${dragging === index ? ' dragging' : ''}`}
            onClick={() => { if (dragging === null) selectSlide(index); }}
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('.slide-actions')) return;
              startY.current = e.clientY;
              const idx = index;
              const onMove = (me: PointerEvent) => { if (Math.abs(me.clientY - startY.current) > 8) setDragging(idx); };
              const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
              window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
            }}
          >
            <span className="slide-number">{index + 1}</span>
            <div className="slide-thumb-clip" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
              <div
                className="slide-thumb-render"
                style={{
                  width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
                  transform: `scale(${THUMB_SCALE})`, transformOrigin: 'top left',
                  position: 'relative', background: '#fff',
                }}
              >
                {/* Body */}
                <div className="slide-content-styles" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'transparent' }}
                  dangerouslySetInnerHTML={{ __html: slide.bodyHtml || '' }} />
                {/* Elements */}
                {slide.elements.map((el) => {
                  if (el.type === 'title') {
                    return (
                      <div key={el.id} style={{
                        position: 'absolute', left: el.position.x, top: el.position.y, width: el.position.width,
                        fontFamily: "'PT Sans', sans-serif", fontWeight: 700, fontSize: el.fontSize || 56,
                        color: '#222', lineHeight: 1.2, overflow: 'hidden',
                      }}>{el.text}</div>
                    );
                  }
                  if (el.type === 'textBox') {
                    return (
                      <div key={el.id} style={{
                        position: 'absolute', left: el.position.x, top: el.position.y,
                        width: el.position.width, height: el.position.height,
                        fontFamily: "'PT Sans', sans-serif", fontSize: 32, color: '#222',
                        overflow: 'hidden', padding: '12px 16px',
                      }} dangerouslySetInnerHTML={{ __html: el.html }} />
                    );
                  }
                  return null;
                })}
              </div>
            </div>
            <div className="slide-actions">
              <button onClick={(e) => { e.stopPropagation(); duplicateSlide(index); }} title="Duplicate">D</button>
              <button onClick={(e) => { e.stopPropagation(); if (presentation.slides.length > 1 && confirm('Delete this slide?')) deleteSlide(index); }} title="Delete">X</button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn-add-slide" onClick={addSlide} title="Add a new slide after the current one">+ Add Slide</button>
    </div>
  );
}
