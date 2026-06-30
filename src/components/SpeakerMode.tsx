/**
 * Speaker mode — shown on the primary monitor while the presenter
 * window runs on the secondary monitor (projector).
 *
 * Shows: current slide notes, timer, next slide preview, slide count,
 * navigation controls.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { usePresentationStore } from '../store/presentation';
import { getSlideNumber } from '../types/presentation';
import { navigatePresenter, closePresenterWindow, swapPresenterDisplay, zoomPresenter } from '../lib/multiMonitor';
import { clamp01 } from '../lib/clamp01';
import { availableMonitors } from '@tauri-apps/api/window';
import { SlideThumbnail } from './SlideThumbnail';
import { ASSET_TIER } from '../lib/assetCache';

export function SpeakerMode() {
  const { presentation, setPresenting } = usePresentationStore();
  const [currentIndex, setCurrentIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  // #29 — zoom the AUDIENCE (projector) slide from here; the audience slide
  // itself has no zoom chrome. Toggle = center zoom; then move over the Current
  // Slide preview to pan the focal point.
  const ZOOM = 2.2;
  const [zoomed, setZoomed] = useState(false);
  // Swap Displays only makes sense with a real second monitor (the dual-screen
  // projector path), not the single-screen screen-share window.
  const [canSwap, setCanSwap] = useState(false);
  useEffect(() => {
    availableMonitors().then((m) => setCanSwap(m.length >= 2)).catch(() => setCanSwap(false));
  }, []);
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
    setZoomed(false);               // a new slide starts un-zoomed (the projector resets too)
    navigatePresenter(index);
    usePresentationStore.getState().selectSlide(index);
  }, [totalSlides]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Toggle audience zoom (center). Pan happens via the preview move handler.
  const toggleZoom = useCallback(() => {
    setZoomed((on) => { const next = !on; void zoomPresenter(next ? ZOOM : 1, 0.5, 0.5); return next; });
  }, []);
  // While zoomed, moving over the Current-Slide preview steers the projector's
  // focal point (normalized [0,1] over the preview, which shows the whole slide).
  const panFromPreview = useCallback((e: React.MouseEvent) => {
    if (!zoomed) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    void zoomPresenter(ZOOM, clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  }, [zoomed]);

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

  // The projector window forwards its own keyboard/clicker presses here (it
  // doesn't own the index). Drive the same goTo so both windows stay in sync.
  useEffect(() => {
    const unlistenP = listen<{ index: number }>('presenter:nav', (e) => goTo(e.payload.index));
    return () => { unlistenP.then((fn) => fn()); };
  }, [goTo]);

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
        <div style={{ display: 'flex', gap: 8 }}>
          {canSwap && (
            <button className="speaker-swap" onClick={() => { void swapPresenterDisplay(); }} title="Swap which display shows the slides vs the speaker view">
              Swap Displays
            </button>
          )}
          <button className="speaker-exit" onClick={() => { closePresenterWindow(); setPresenting(false); }}>
            End Presentation
          </button>
        </div>
      </div>

      <div className="speaker-body">
        {/* Current slide preview */}
        <div className="speaker-current">
          <div className="speaker-preview-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Current Slide{zoomed && <span className="speaker-zoom-hint"> — move to pan the audience view</span>}</span>
            <button className="speaker-zoom-btn" onClick={toggleZoom} aria-pressed={zoomed}
              title="Zoom the audience slide (then move over this preview to pan)">
              {zoomed ? 'Zoom out' : 'Zoom in'}
            </button>
          </div>
          <div className="speaker-preview" style={zoomed ? { cursor: 'crosshair' } : undefined} onMouseMove={panFromPreview}>
            {slide && <SlideThumbnail presentation={presentation} slide={slide} imageTier={ASSET_TIER.full} />}
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
              <SlideThumbnail presentation={presentation} slide={nextSlide} imageTier={ASSET_TIER.full} />
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
