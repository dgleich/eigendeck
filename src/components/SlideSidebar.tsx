import { useRef, useState, useCallback, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import { getSlideNumber, isGroupChild } from '../types/presentation';
import type { MenuEntry } from './ContextMenu';
import { SlideThumbnail } from './SlideThumbnail';
import { askConfirm } from '../lib/confirmDialog';

const THUMB_WIDTH = 166;

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

  // Scroll the active slide into view when currentSlideIndex changes — and, if the
  // sidebar already holds keyboard focus (e.g. arrow-key slide nav), move focus to
  // the active thumbnail so Backspace deletes the highlighted slide, not the one
  // that happened to be focused before. Guarded so we never steal focus from the
  // canvas / a text field during a programmatic selectSlide (undo-nav, etc.).
  useEffect(() => {
    if (!containerRef.current) return;
    const thumbs = containerRef.current.querySelectorAll('.slide-thumbnail');
    const active = thumbs[currentSlideIndex] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (containerRef.current.contains(document.activeElement) && document.activeElement !== active) {
        active.focus();
      }
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
            // Focusable so the slide can be deleted from the keyboard (and so the
            // sidebar is the keydown target — Backspace deletes the focused slide
            // instead of triggering the webview's history-back). a11y: keyboard nav.
            tabIndex={0}
            onClick={(e) => { if (dragging === null) { selectSlide(index); e.currentTarget.focus(); } }}
            onKeyDown={(e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace')) {
                // A thumbnail keeps DOM focus after you click an element on the
                // canvas, so this handler would otherwise delete the SLIDE when an
                // element is selected. Only delete the slide when a slide is
                // actually the selection; otherwise let it bubble to the global
                // handler, which deletes the selected element(s). (#: backspace bug)
                const sel = usePresentationStore.getState().selectedObject;
                if (sel && sel.type !== 'slide') return;
                e.preventDefault(); e.stopPropagation();
                if (presentation.slides.length > 1) {
                  deleteSlide(index);
                  // The deleted thumbnail's DOM focus falls to <body>, and
                  // currentSlideIndex often doesn't change, so the focus effect
                  // above won't re-fire. Re-focus the neighbour thumbnail once
                  // the list re-renders so repeated Delete keeps working (#124).
                  requestAnimationFrame(() => {
                    const thumbs = containerRef.current?.querySelectorAll('.slide-thumbnail');
                    const newIdx = usePresentationStore.getState().currentSlideIndex;
                    (thumbs?.[newIdx] as HTMLElement | undefined)?.focus();
                  });
                }
              }
            }}
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
            <SlideThumbnail presentation={presentation} slide={slide} width={THUMB_WIDTH} />
            <div className="slide-actions">
              <button onClick={(e) => { e.stopPropagation(); duplicateSlide(index); }} title="Duplicate">D</button>
              <button onClick={async (e) => { e.stopPropagation(); if (presentation.slides.length > 1 && await askConfirm('Delete this slide?')) deleteSlide(index); }} title="Delete">X</button>
            </div>
          </div>
          );
        })}
      </div>
      <button className="btn-add-slide" onClick={addSlide} title="Add a new slide after the current one">+ Add Slide</button>
    </div>
  );
}
