/**
 * Speaker mode — shown on the primary monitor while the presenter
 * window runs on the secondary monitor (projector).
 *
 * Shows: current slide notes, timer, next slide preview, slide count,
 * navigation controls.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';
import { getSlideNumber, TEXT_PRESET_STYLES } from '../types/presentation';
import { navigatePresenter, closePresenterWindow } from '../lib/multiMonitor';

export function SpeakerMode() {
  const { presentation, setPresenting } = usePresentationStore();
  const [currentIndex, setCurrentIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const startTime = useRef(Date.now());
  const timerRef = useRef<number | null>(null);

  const totalSlides = presentation.slides.length;

  // Timer
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const goTo = useCallback((index: number) => {
    if (index < 0 || index >= totalSlides) return;
    setCurrentIndex(index);
    navigatePresenter(index);
    usePresentationStore.getState().selectSlide(index);
  }, [totalSlides]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closePresenterWindow();
          setPresenting(false);
          break;
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
          e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); goPrev(); break;
        case 'Home': e.preventDefault(); goTo(0); break;
        case 'End': e.preventDefault(); goTo(totalSlides - 1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goTo, totalSlides, setPresenting]);

  const slide = presentation.slides[currentIndex];
  const nextSlide = currentIndex < totalSlides - 1 ? presentation.slides[currentIndex + 1] : null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="speaker-mode">
      <div className="speaker-header">
        <div className="speaker-timer">
          <span className="speaker-time">{formatTime(elapsed)}</span>
          <button onClick={() => setTimerRunning(!timerRunning)}>
            {timerRunning ? 'Pause' : 'Resume'}
          </button>
          <button onClick={() => { startTime.current = Date.now(); setElapsed(0); }}>
            Reset
          </button>
        </div>
        <div className="speaker-slide-count">
          Slide {currentIndex + 1} / {totalSlides}
          {' '}(#{getSlideNumber(presentation.slides, currentIndex)})
        </div>
        <button className="speaker-exit" onClick={() => { closePresenterWindow(); setPresenting(false); }}>
          End Presentation
        </button>
      </div>

      <div className="speaker-body">
        {/* Current slide preview */}
        <div className="speaker-current">
          <div className="speaker-preview-label">Current Slide</div>
          <div className="speaker-preview">
            <div style={{
              width: 1920, height: 1080, transform: 'scale(0.35)', transformOrigin: 'top left',
              background: '#fff', position: 'relative', border: '1px solid #ddd',
            }}>
              {slide?.elements.map((el, idx) => (
                <SpeakerPreviewElement key={el.id} element={el} zIndex={idx} />
              ))}
            </div>
          </div>
          {/* Notes */}
          <div className="speaker-notes">
            <div className="speaker-notes-label">Notes</div>
            <div className="speaker-notes-text">
              {slide?.notes || <span style={{ color: '#999', fontStyle: 'italic' }}>No notes for this slide</span>}
            </div>
          </div>
        </div>

        {/* Next slide preview */}
        <div className="speaker-next">
          <div className="speaker-preview-label">Next Slide</div>
          {nextSlide ? (
            <div className="speaker-preview speaker-preview-small">
              <div style={{
                width: 1920, height: 1080, transform: 'scale(0.25)', transformOrigin: 'top left',
                background: '#fff', position: 'relative', border: '1px solid #ddd',
              }}>
                {nextSlide.elements.map((el, idx) => (
                  <SpeakerPreviewElement key={el.id} element={el} zIndex={idx} />
                ))}
              </div>
            </div>
          ) : (
            <div className="speaker-preview-empty">End of presentation</div>
          )}
        </div>
      </div>

      <div className="speaker-nav">
        <button onClick={goPrev} disabled={currentIndex === 0}>&larr; Previous</button>
        <button onClick={goNext} disabled={currentIndex >= totalSlides - 1}>Next &rarr;</button>
      </div>
    </div>
  );
}

/** Simplified element preview for speaker view (no interactivity, no MathJax) */
function SpeakerPreviewElement({ element: el, zIndex }: { element: import('../types/presentation').SlideElement; zIndex: number }) {
  const p = el.position;

  switch (el.type) {
    case 'text': {
      const ps = TEXT_PRESET_STYLES[el.preset];
      return (
        <div style={{
          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
          fontFamily: el.fontFamily || ps.fontFamily, fontWeight: ps.fontWeight,
          fontStyle: ps.fontStyle, fontSize: el.fontSize || ps.fontSize,
          color: el.color || ps.color, lineHeight: 1.3, overflow: 'hidden', padding: '8px 12px',
          zIndex,
        }} dangerouslySetInnerHTML={{ __html: el.html }} />
      );
    }
    case 'image':
      return <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, background: '#f0f0f0', zIndex }} />;
    case 'cover':
      return <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, background: el.color || '#fff', zIndex }} />;
    case 'demo': case 'demo-piece':
      return <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, background: '#e8f4f8', border: '1px dashed #93c5fd', zIndex }} />;
    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 3 } = el;
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
        </svg>
      );
    }
    default: return null;
  }
}
