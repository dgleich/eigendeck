import { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { SpeakerPanel } from './SpeakerView';
import { TEXT_PRESET_STYLES } from '../types/presentation';
import { typesetElement, resetMathElement, containsMath } from '../lib/mathjax';
import type { SlideElement, TextElement } from '../types/presentation';

export function PresentMode() {
  const { presentation, setPresenting, selectSlide, projectPath } =
    usePresentationStore();
  const [currentIndex, setCurrentIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const [showSpeaker, setShowSpeaker] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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
      setCurrentIndex(index);
      selectSlide(index);
    },
    [totalSlides, selectSlide]
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

  const slide = presentation.slides[currentIndex];
  if (!slide) return null;

  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div className="present-viewport" ref={viewportRef}>
        <div className="present-slide-wrapper" style={{ width: slideW * scale, height: slideH * scale }}>
          <div
            className={`present-slide slide-layout-${slide.layout || 'default'}`}
            style={{ width: slideW, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            {/* Elements in z-order */}
            {slide.elements.map((el, idx) => (
              <PresentElement key={el.id} element={el} zIndex={idx + 10} projectPath={projectPath} />
            ))}

            {/* Footer */}
            <div className="slide-footer" style={{ zIndex: 1000 }}>
              <span className="slide-footer-meta">{meta}</span>
              <span className="slide-footer-number">{currentIndex + 1}</span>
            </div>
          </div>
        </div>
      </div>
      {showSpeaker && <SpeakerPanel />}
    </div>
  );
}

function PresentElement({ element: el, zIndex, projectPath }: { element: SlideElement; zIndex: number; projectPath: string | null }) {
  const pos = el.position;

  switch (el.type) {
    case 'text':
      return <PresentTextElement element={el} zIndex={zIndex} />;

    case 'image': {
      let src = el.src;
      if (!src.startsWith('data:') && projectPath) {
        try { src = convertFileSrc(`${projectPath}/${el.src}`); } catch { /* keep original */ }
      }
      return (
        <img src={src} alt="" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          objectFit: 'contain', zIndex,
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
        }} />
      );
    }

    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
          <polygon points={`${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}`} fill={color} />
        </svg>
      );
    }
  }
}

function PresentTextElement({ element: el, zIndex }: { element: TextElement; zIndex: number }) {
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
    <div ref={ref} style={{
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
    }} />
  );
}
