import { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { SpeakerPanel } from './SpeakerView';
import { TEXT_PRESET_STYLES, getSlideNumber } from '../types/presentation';
import { typesetElement, resetMathElement, containsMath } from '../lib/mathjax';
import type { Slide, SlideElement, TextElement } from '../types/presentation';

const TRANSITION_MS = 300;

export function PresentMode() {
  const { presentation, setPresenting, selectSlide, projectPath } =
    usePresentationStore();
  const [currentIndex, setCurrentIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const [showSpeaker, setShowSpeaker] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Animation state
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const animTimerRef = useRef<number | null>(null);

  const totalSlides = presentation.slides.length;
  const slideW = presentation.config.width;
  const slideH = presentation.config.height;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setScale(Math.min(width / slideW, height / slideH));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [slideW, slideH]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalSlides) return;
      if (index === currentIndex) return;
      if (animTimerRef.current) clearTimeout(animTimerRef.current);

      setPrevIndex(currentIndex);
      setCurrentIndex(index);
      selectSlide(index);

      // Start animation — after a frame so the DOM has both slides
      requestAnimationFrame(() => {
        setAnimating(true);
        animTimerRef.current = window.setTimeout(() => {
          setAnimating(false);
          setPrevIndex(null);
          animTimerRef.current = null;
        }, TRANSITION_MS);
      });
    },
    [currentIndex, totalSlides, selectSlide]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape': setPresenting(false); break;
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
          e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); goPrev(); break;
        case 's': case 'S':
          e.preventDefault(); setShowSpeaker((prev) => !prev); break;
        case 'Home': e.preventDefault(); goTo(0); break;
        case 'End': e.preventDefault(); goTo(totalSlides - 1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goTo, totalSlides, setPresenting]);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  const slide = presentation.slides[currentIndex];
  if (!slide) return null;

  const prevSlide = prevIndex !== null ? presentation.slides[prevIndex] : null;
  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  // Diff linked elements between prev and current slide
  const linkedTransitions = computeLinkedTransitions(prevSlide, slide);

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div className="present-viewport" ref={viewportRef}>
        <div className="present-slide-wrapper" style={{ width: slideW * scale, height: slideH * scale }}>
          <div
            className={`present-slide slide-layout-${slide.layout || 'default'}`}
            style={{ width: slideW, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            {/* Fading out elements (from previous slide, no match in current) */}
            {linkedTransitions.fadeOut.map((el, idx) => (
              <PresentElement
                key={`fadeout-${el.id}`}
                element={el}
                zIndex={idx + 1}
                projectPath={projectPath}
                style={{
                  opacity: animating ? 0 : 1,
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* Linked elements that animate position/size */}
            {linkedTransitions.linked.map(({ from, to }, idx) => {
              // During animation, show the element transitioning from old to new position
              const displayEl = to;
              const fromPos = getElementBounds(from);
              const toPos = getElementBounds(to);

              return (
                <PresentElement
                  key={`linked-${to.id}`}
                  element={displayEl}
                  zIndex={idx + 10}
                  projectPath={projectPath}
                  style={{
                    // Start at old position, transition to new
                    ...(prevIndex !== null ? {
                      left: animating ? toPos.x : fromPos.x,
                      top: animating ? toPos.y : fromPos.y,
                      width: animating ? toPos.w : fromPos.w,
                      height: animating ? toPos.h : fromPos.h,
                      transition: animating ? `left ${TRANSITION_MS}ms ease-in-out, top ${TRANSITION_MS}ms ease-in-out, width ${TRANSITION_MS}ms ease-in-out, height ${TRANSITION_MS}ms ease-in-out, opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                    } : {}),
                  }}
                />
              );
            })}

            {/* Fading in elements (new in current slide, no match in previous) */}
            {linkedTransitions.fadeIn.map((el, idx) => (
              <PresentElement
                key={`fadein-${el.id}`}
                element={el}
                zIndex={idx + 100}
                projectPath={projectPath}
                style={{
                  opacity: animating ? 1 : (prevIndex !== null ? 0 : 1),
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* Unlinked elements (no linkId, current slide only) */}
            {linkedTransitions.unlinked.map((el, idx) => (
              <PresentElement
                key={el.id}
                element={el}
                zIndex={idx + 200}
                projectPath={projectPath}
                style={{
                  opacity: prevIndex !== null ? (animating ? 1 : 0) : 1,
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* Footer */}
            <div className="slide-footer" style={{ zIndex: 1000 }}>
              <span className="slide-footer-meta">{meta}</span>
              <span className="slide-footer-number">{getSlideNumber(presentation.slides, currentIndex)}</span>
            </div>
          </div>
        </div>
      </div>
      {showSpeaker && <SpeakerPanel />}
    </div>
  );
}

// ============================================
// Compute linked object transitions
// ============================================

interface LinkedTransitions {
  linked: { from: SlideElement; to: SlideElement }[];
  fadeIn: SlideElement[];
  fadeOut: SlideElement[];
  unlinked: SlideElement[];
}

function computeLinkedTransitions(prevSlide: Slide | null, currentSlide: Slide): LinkedTransitions {
  const result: LinkedTransitions = { linked: [], fadeIn: [], fadeOut: [], unlinked: [] };

  if (!prevSlide) {
    // No previous slide — everything just appears
    result.unlinked = currentSlide.elements;
    return result;
  }

  const prevByLinkId = new Map<string, SlideElement>();
  const prevUnlinked = new Set<string>(); // track prev elements without linkId
  for (const el of prevSlide.elements) {
    if (el.linkId) prevByLinkId.set(el.linkId, el);
    else prevUnlinked.add(el.id);
  }

  const matchedPrevLinkIds = new Set<string>();

  for (const el of currentSlide.elements) {
    if (el.linkId && prevByLinkId.has(el.linkId)) {
      result.linked.push({ from: prevByLinkId.get(el.linkId)!, to: el });
      matchedPrevLinkIds.add(el.linkId);
    } else if (el.linkId) {
      result.fadeIn.push(el);
    } else {
      result.unlinked.push(el);
    }
  }

  // Previous elements with linkId that have no match in current — fade out
  for (const el of prevSlide.elements) {
    if (el.linkId && !matchedPrevLinkIds.has(el.linkId)) {
      result.fadeOut.push(el);
    }
  }

  return result;
}

function getElementBounds(el: SlideElement): { x: number; y: number; w: number; h: number } {
  if (el.type === 'arrow') {
    const { x1, y1, x2, y2 } = el;
    const pad = 30;
    return {
      x: Math.min(x1, x2) - pad,
      y: Math.min(y1, y2) - pad,
      w: Math.abs(x2 - x1) + pad * 2,
      h: Math.abs(y2 - y1) + pad * 2,
    };
  }
  return { x: el.position.x, y: el.position.y, w: el.position.width, h: el.position.height };
}

// ============================================
// Present element renderers
// ============================================

function PresentElement({ element: el, zIndex, projectPath, style }: {
  element: SlideElement; zIndex: number; projectPath: string | null;
  style?: React.CSSProperties;
}) {
  const pos = el.position;

  switch (el.type) {
    case 'text':
      return <PresentTextElement element={el} zIndex={zIndex} style={style} />;

    case 'image': {
      let src = el.src;
      if (!src.startsWith('data:') && projectPath) {
        try { src = convertFileSrc(`${projectPath}/${el.src}`); } catch { /* keep original */ }
      }
      return (
        <img src={src} alt="" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          objectFit: 'contain', zIndex,
          ...style,
        }} />
      );
    }

    case 'demo': {
      let src: string | undefined;
      if (projectPath) { try { src = convertFileSrc(`${projectPath}/${el.src}`); } catch { /* skip */ } }
      if (!src) return null;
      return (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title="demo" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          border: 'none', zIndex,
          ...style,
        }} />
      );
    }

    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      return (
        <svg style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none', overflow: 'visible', zIndex,
          ...style,
        }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
          <polygon points={`${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}`} fill={color} />
        </svg>
      );
    }
  }
}

function PresentTextElement({ element: el, zIndex, style }: { element: TextElement; zIndex: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = el.position;
  const preset = TEXT_PRESET_STYLES[el.preset];

  useEffect(() => {
    if (ref.current) {
      // Set raw HTML first, then typeset math if present
      resetMathElement(ref.current, el.html);
      if (containsMath(el.html)) {
        typesetElement(ref.current);
      }
    }
  }, [el.html]);

  return (
    <div ref={ref} className={`el-text el-preset-${el.preset}`} style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
      fontFamily: el.fontFamily || preset.fontFamily,
      fontSize: el.fontSize || preset.fontSize,
      fontWeight: preset.fontWeight,
      fontStyle: preset.fontStyle,
      color: el.color || preset.color,
      lineHeight: 1.3,
      padding: '8px 12px',
      overflow: 'hidden',
      zIndex,
      ...style,
    }} />
  );
}
