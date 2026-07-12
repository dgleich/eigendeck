import { useState, useEffect, useCallback, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import type { SlideElement } from '../types/presentation';
import { ElementPreviewImg } from './ElementPreviewImg';
import { VideoThumb } from './VideoThumb';
import { arrowBBox } from '../lib/arrowGeometry.mjs';
import { ArrowGlyph } from './ArrowGlyph';
import { describeCover, describeArrow } from '../lib/elementDescriptor.mjs';
import { ELEMENT_PLACEHOLDERS as PH } from '../lib/elementPlaceholders.mjs';

const SLIDE_W = 1920;
const SLIDE_H = 1080;

interface Props {
  elementId: string;
  onClose: () => void;
}

export function LinkOverlay({ elementId, onClose }: Props) {
  const { presentation, currentSlideIndex } = usePresentationStore();
  const [viewIndex, setViewIndex] = useState(Math.max(0, currentSlideIndex - 1));

  const containerRef = useRef<HTMLDivElement>(null);
  const [slideScale, setSlideScale] = useState(0.5);

  const currentSlide = presentation.slides[currentSlideIndex];
  const sourceElement = currentSlide?.elements.find((el) => el.id === elementId);

  // Scale slide to fit container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setSlideScale(width / SLIDE_W);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Navigate with arrow keys (skip current slide)
  const navPrev = useCallback(() => {
    setViewIndex((i) => {
      let next = i - 1;
      if (next === currentSlideIndex) next--;
      return Math.max(0, next);
    });
  }, [currentSlideIndex]);

  const navNext = useCallback(() => {
    setViewIndex((i) => {
      let next = i + 1;
      if (next === currentSlideIndex) next++;
      return Math.min(presentation.slides.length - 1, next);
    });
  }, [currentSlideIndex, presentation.slides.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); navPrev(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); navNext(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, navPrev, navNext]);

  // Establish an ANIMATION link to the clicked target. Non-destructive: both
  // elements stay separate; only a shared linkId is set. (Syncing/merging is a
  // deliberate, separate action — never a side effect of picking a link target.)
  const handleElementClick = useCallback((targetEl: SlideElement) => {
    if (!sourceElement) return;
    usePresentationStore.getState().linkElements(elementId, viewIndex, targetEl.id);
    onClose();
  }, [sourceElement, elementId, viewIndex, onClose]);

  if (!sourceElement) { onClose(); return null; }

  // Build the stack of slides to show (exclude current)
  const otherSlides = presentation.slides
    .map((slide, idx) => ({ slide, idx }))
    .filter(({ idx }) => idx !== currentSlideIndex);

  if (otherSlides.length === 0) { onClose(); return null; }

  // Clamp viewIndex
  const viewSlideEntry = otherSlides.find(({ idx }) => idx === viewIndex)
    || otherSlides[otherSlides.length - 1];
  const viewSlide = viewSlideEntry.slide;

  return (
    <div className="link-overlay" onClick={onClose}>
      <div className="link-overlay-content" onClick={(e) => e.stopPropagation()}>
        <div className="link-overlay-header">
          <span>Click an element on slide {viewSlideEntry.idx + 1} to link</span>
          <div className="link-overlay-nav">
            <button disabled={viewIndex <= 0} onClick={navPrev}>&larr;</button>
            <span>Slide {viewSlideEntry.idx + 1} / {presentation.slides.length}</span>
            <button disabled={viewIndex >= presentation.slides.length - 1} onClick={navNext}>&rarr;</button>
          </div>
          <button className="link-overlay-close" onClick={onClose}>Cancel</button>
        </div>

        {/* Slide preview — scaled to fit container */}
        <div className="link-overlay-slide-container" ref={containerRef}>
          <div className="link-overlay-slide" style={{
            width: SLIDE_W, height: SLIDE_H,
            position: 'relative', background: '#fff',
            transform: `scale(${slideScale})`,
            transformOrigin: 'top left',
          }}>
            {viewSlide.elements.map((el) => {
              // A target is linkable only if it's the SAME type and NOT itself
              // synced. Cross-type links could later promote-sync one type over
              // another (losing a notebook's recording); a synced element can't
              // animate (it shares one position across slides). Both show dimmed
              // + inert. (The L badge is likewise disabled on synced sources.)
              const linkable = el.type === sourceElement.type && !el.syncId;
              return (
                <LinkableElement
                  key={el.id}
                  element={el}
                  linkable={linkable}
                  isLinked={!!(sourceElement.linkId && el.linkId === sourceElement.linkId)}
                  onClick={() => { if (linkable) handleElementClick(el); }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkableElement({ element: el, isLinked, linkable = true, onClick }: {
  element: SlideElement; isLinked: boolean; linkable?: boolean; onClick: () => void;
}) {
  const p = el.position;
  const config = usePresentationStore.getState().presentation.config;

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: p.x, top: p.y, width: p.width, height: p.height,
    cursor: linkable ? 'pointer' : 'not-allowed',
    border: isLinked ? '4px solid #16a34a' : '4px solid transparent',
    borderRadius: 4,
    transition: 'border-color 0.15s',
    zIndex: 10,
    // Off-type targets are inert: dimmed and non-interactive (kept visible for
    // spatial context so you still see what's on the slide).
    opacity: linkable ? 1 : 0.3,
    pointerEvents: linkable ? 'auto' : 'none',
  };

  switch (el.type) {
    case 'text': {
      const ps = TEXT_PRESET_STYLES[el.preset];
      return (
        <div style={wrapStyle} onClick={onClick}
          className="link-overlay-element"
        >
          <div style={{
            width: '100%', height: '100%',
            fontFamily: el.fontFamily || ps.fontFamily, fontWeight: ps.fontWeight,
            fontStyle: ps.fontStyle, fontSize: effectiveFontSize(el, config),
            color: el.color || ps.color, lineHeight: 1.3, overflow: 'hidden', padding: '8px 12px',
            pointerEvents: 'none',
          }} dangerouslySetInnerHTML={{ __html: el.html }} />
        </div>
      );
    }
    case 'image':
      return (
        <div style={{ ...wrapStyle, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, color: '#aaa' }}
          onClick={onClick} className="link-overlay-element">
          IMG
        </div>
      );
    case 'demo':
      return (
        <div style={{ ...wrapStyle, background: PH.demo.bg, border: isLinked ? '4px solid #16a34a' : `4px dashed ${PH.demo.borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: PH.demo.color }}
          onClick={onClick} className="link-overlay-element">
          {PH.demo.label}
        </div>
      );
    case 'video':
      return (
        <div style={{ ...wrapStyle, background: '#000', overflow: 'hidden' }}
          onClick={onClick} className="link-overlay-element">
          <VideoThumb element={el} />
        </div>
      );
    case 'notebook':
      return (
        <div style={{ ...wrapStyle, background: PH.notebook.bg, border: isLinked ? '4px solid #16a34a' : `4px dashed ${PH.notebook.borderColor}`, overflow: 'hidden' }}
          onClick={onClick} className="link-overlay-element">
          <ElementPreviewImg
            cacheKey={el.syncId ?? el.id}
            fallback={
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, color: PH.notebook.color }}>{PH.notebook.label}</div>
            }
          />
        </div>
      );
    case 'demo-piece':
      return (
        <div style={{ ...wrapStyle, background: PH['demo-piece'].bg, border: isLinked ? '4px solid #16a34a' : `4px dashed ${PH['demo-piece'].borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: PH['demo-piece'].color }}
          onClick={onClick} className="link-overlay-element">
          {el.piece}
        </div>
      );
    case 'cover':
      return (
        <div style={{ ...wrapStyle, background: describeCover(el, '#fff').background, border: isLinked ? '4px solid #16a34a' : '4px solid #ddd' }}
          onClick={onClick} className="link-overlay-element" />
      );
    case 'arrow': {
      const a = describeArrow(el);
      const { x1, y1, x2, y2, geo, color } = a;
      // Bounding-box click target — arrowBBox includes any Bézier control points
      // so a curved arrow's hit area still covers the bowed-out curve.
      const { minX: bx, minY: by, maxX, maxY } = arrowBBox(x1, y1, x2, y2, a.headSize, a.heads, 30, a.c1x, a.c1y, a.c2x, a.c2y);
      const bw = maxX - bx, bh = maxY - by;
      return (
        <div style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, cursor: 'pointer', zIndex: 10 }}
          onClick={onClick} className="link-overlay-element">
          <svg width={bw} height={bh} style={{ overflow: 'visible' }}>
            {/* fat transparent hit target follows the (un-inset) curve or line */}
            {geo.curved
              ? <path d={geo.path} transform={`translate(${-bx} ${-by})`} fill="none" stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke' }} />
              : <line x1={x1 - bx} y1={y1 - by} x2={x2 - bx} y2={y2 - by} stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke' }} />}
            <ArrowGlyph geo={geo} color={color} strokeWidth={a.strokeWidth} opacity={a.opacity} dx={bx} dy={by} />
          </svg>
          {isLinked && <div style={{ position: 'absolute', inset: 0, border: '4px solid #16a34a', borderRadius: 4 }} />}
        </div>
      );
    }
  }
}
