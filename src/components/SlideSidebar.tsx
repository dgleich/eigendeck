import { useRef, useState, useCallback, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import { TEXT_PRESET_STYLES, getSlideNumber, isGroupChild } from '../types/presentation';
import type { MenuEntry } from './ContextMenu';

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

  // Scroll the active slide into view when currentSlideIndex changes
  useEffect(() => {
    if (!containerRef.current) return;
    const thumbs = containerRef.current.querySelectorAll('.slide-thumbnail');
    const active = thumbs[currentSlideIndex] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentSlideIndex]);

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
    if (dragging !== null) {
      // Clear any text selection that happened during drag
      window.getSelection()?.removeAllRanges();
    }
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
        {presentation.slides.map((slide, index) => {
          const child = isGroupChild(presentation.slides, index);
          const slideNum = getSlideNumber(presentation.slides, index);
          return (
          <div
            key={slide.id}
            className={`slide-thumbnail${index === currentSlideIndex ? ' active' : ''}${dropTarget === index ? ' drag-over' : ''}${dragging === index ? ' dragging' : ''}${child ? ' group-child' : ''}${slide.groupId ? ' in-group' : ''}`}
            onClick={() => { if (dragging === null) selectSlide(index); }}
            onContextMenu={(e) => {
              e.preventDefault();
              selectSlide(index);
              const store = usePresentationStore.getState();
              const items: MenuEntry[] = [
                { label: 'Duplicate Slide', shortcut: 'D', onClick: () => duplicateSlide(index) },
                { label: 'Add Build Slide', onClick: () => store.addBuildSlide() },
                { separator: true },
                { label: 'Delete Slide', shortcut: 'X', onClick: () => deleteSlide(index), disabled: presentation.slides.length <= 1 },
              ];
              window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('.slide-actions')) return;
              startY.current = e.clientY;
              const idx = index;
              const onMove = (me: PointerEvent) => { if (Math.abs(me.clientY - startY.current) > 8) setDragging(idx); };
              const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
              window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
            }}
          >
            <span className="slide-number">{child ? '' : slideNum}</span>
            <div className="slide-thumb-clip" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
              <div
                className="slide-thumb-render"
                style={{
                  width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
                  transform: `scale(${THUMB_SCALE})`, transformOrigin: 'top left',
                  position: 'relative', background: '#fff',
                }}
              >
                {/* Elements */}
                {slide.elements.map((el) => {
                  const p = el.position;
                  switch (el.type) {
                    case 'text': {
                      const ps = TEXT_PRESET_STYLES[el.preset];
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          fontFamily: el.fontFamily || ps.fontFamily, fontWeight: ps.fontWeight,
                          fontStyle: ps.fontStyle, fontSize: el.fontSize || ps.fontSize,
                          color: el.color || ps.color, lineHeight: 1.3, overflow: 'hidden', padding: '8px 12px',
                        }} dangerouslySetInnerHTML={{ __html: el.html }} />
                      );
                    }
                    case 'image':
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 24, color: '#aaa',
                        }}>IMG</div>
                      );
                    case 'arrow': {
                      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 3 } = el;
                      return (
                        <svg key={el.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
                        </svg>
                      );
                    }
                    case 'demo':
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          background: '#e8f4f8', border: '1px dashed #93c5fd', borderRadius: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 20, color: '#60a5fa',
                        }}>DEMO</div>
                      );
                    case 'demo-piece':
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          background: '#f0e8f8', border: '1px dashed #a78bfa', borderRadius: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, color: '#7c3aed',
                        }}>{el.piece}</div>
                      );
                    case 'cover':
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          background: el.color || '#fff', border: '1px solid #ddd',
                        }} />
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
            <div className="slide-actions">
              <button onClick={(e) => { e.stopPropagation(); duplicateSlide(index); }} title="Duplicate">D</button>
              <button onClick={(e) => { e.stopPropagation(); if (presentation.slides.length > 1 && confirm('Delete this slide?')) deleteSlide(index); }} title="Delete">X</button>
            </div>
          </div>
          );
        })}
      </div>
      <button className="btn-add-slide" onClick={addSlide} title="Add a new slide after the current one">+ Add Slide</button>
    </div>
  );
}
