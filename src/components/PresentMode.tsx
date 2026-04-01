import { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { SpeakerPanel } from './SpeakerView';
import type { Slide } from '../types/presentation';

/**
 * Custom presenter — renders slides identically to the editor.
 * No reveal.js. Uses CSS transitions between slides.
 * Arrow keys / spacebar to navigate, Escape to exit, S for speaker panel.
 */
export function PresentMode() {
  const { presentation, setPresenting, selectSlide, projectPath } =
    usePresentationStore();
  const [currentIndex, setCurrentIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const [showSpeaker, setShowSpeaker] = useState(false);
  const [transition, setTransition] = useState<'none' | 'left' | 'right'>('none');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const totalSlides = presentation.slides.length;
  const slideW = presentation.config.width;
  const slideH = presentation.config.height;

  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  // Scale slide to fit viewport, preserving aspect ratio
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setScale(Math.min(width / slideW, height / slideH));
        setViewportSize({ w: width, h: height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [slideW, slideH]);

  const goTo = useCallback(
    (index: number, direction: 'left' | 'right') => {
      if (index < 0 || index >= totalSlides) return;
      setTransition(direction);
      setTimeout(() => {
        setCurrentIndex(index);
        selectSlide(index);
        setTransition('none');
      }, 200);
    },
    [totalSlides, selectSlide]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1, 'left'), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1, 'right'), [currentIndex, goTo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          setPresenting(false);
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          goPrev();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          setShowSpeaker((prev) => !prev);
          break;
        case 'Home':
          e.preventDefault();
          goTo(0, 'right');
          break;
        case 'End':
          e.preventDefault();
          goTo(totalSlides - 1, 'left');
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goTo, totalSlides, setPresenting]);

  const slide = presentation.slides[currentIndex];
  if (!slide) return null;

  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div className="present-viewport" ref={viewportRef}>
        <div
          className={`present-slide slide-layout-${slide.layout || 'default'} present-transition-${transition}`}
          style={{
            width: slideW,
            height: slideH,
            transform: `scale(${scale})`,
            marginLeft: (viewportSize.w - slideW * scale) / 2,
            marginTop: (viewportSize.h - slideH * scale) / 2,
          }}
        >
          <SlideRenderer slide={slide} projectPath={projectPath} />
          <div className="slide-footer">
            <span className="slide-footer-meta">{meta}</span>
            <span className="slide-footer-number">{currentIndex + 1}</span>
          </div>
        </div>
      </div>
      {showSpeaker && <SpeakerPanel />}
    </div>
  );
}

/** Renders a single slide's content — used by both present mode and (later) thumbnails */
function SlideRenderer({
  slide,
  projectPath,
}: {
  slide: Slide;
  projectPath: string | null;
}) {
  // Title
  const title = slide.content.title;

  // Image src
  let imgSrc: string | undefined;
  if (slide.content.image) {
    if (slide.content.image.startsWith('data:')) {
      imgSrc = slide.content.image;
    } else if (projectPath) {
      try {
        imgSrc = convertFileSrc(`${projectPath}/${slide.content.image}`);
      } catch {
        imgSrc = undefined;
      }
    }
  }
  const imgPos = slide.content.imagePosition || { x: 360, y: 200, width: 1200, height: 680 };

  // Demo src
  let demoSrc: string | undefined;
  if (slide.content.demo && projectPath) {
    try {
      demoSrc = convertFileSrc(`${projectPath}/${slide.content.demo}`);
    } catch {
      demoSrc = undefined;
    }
  }
  const demoPos = slide.content.demoPosition || { x: 0, y: 200, width: 800, height: 400 };

  return (
    <>
      {/* Title */}
      {title && (
        <div
          className="present-title"
          style={{
            position: 'absolute',
            left: title.position.x,
            top: title.position.y,
            width: title.position.width,
            height: title.position.height,
            fontSize: title.fontSize || 56,
          }}
        >
          {title.text}
        </div>
      )}

      {/* Main body content */}
      <div
        className="present-body slide-content-styles"
        dangerouslySetInnerHTML={{ __html: slide.content.html || '' }}
      />

      {/* Image */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt=""
          style={{
            position: 'absolute',
            left: imgPos.x,
            top: imgPos.y,
            width: imgPos.width,
            height: imgPos.height,
            objectFit: 'contain',
          }}
        />
      )}

      {/* Demo iframe */}
      {demoSrc && (
        <iframe
          src={demoSrc}
          sandbox="allow-scripts allow-same-origin"
          title="demo"
          style={{
            position: 'absolute',
            left: demoPos.x,
            top: demoPos.y,
            width: demoPos.width,
            height: demoPos.height,
            border: 'none',
          }}
        />
      )}

      {/* Text boxes */}
      {(slide.content.textBoxes || []).map((box) => (
        <div
          key={box.id}
          style={{
            position: 'absolute',
            left: box.position.x,
            top: box.position.y,
            width: box.position.width,
            height: box.position.height,
          }}
          className="present-textbox"
          dangerouslySetInnerHTML={{ __html: box.html }}
        />
      ))}

      {/* Arrows */}
      {(slide.content.arrows || []).length > 0 && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {(slide.content.arrows || []).map((a) => {
            const color = a.color || '#e53e3e';
            const sw = a.strokeWidth || 4;
            const hs = a.headSize || 16;
            const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
            const ha = Math.PI / 6;
            const hx1 = a.x2 - hs * Math.cos(angle - ha);
            const hy1 = a.y2 - hs * Math.sin(angle - ha);
            const hx2 = a.x2 - hs * Math.cos(angle + ha);
            const hy2 = a.y2 - hs * Math.sin(angle + ha);
            return (
              <g key={a.id}>
                <line
                  x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
                  stroke={color} strokeWidth={sw}
                />
                <polygon
                  points={`${a.x2},${a.y2} ${hx1},${hy1} ${hx2},${hy2}`}
                  fill={color}
                />
              </g>
            );
          })}
        </svg>
      )}
    </>
  );
}
