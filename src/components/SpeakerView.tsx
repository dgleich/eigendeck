import { useState, useEffect, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';

/**
 * Standalone speaker view component.
 * Shows current slide notes, next slide preview, and a timer.
 * Rendered in the main window as a split view when activated.
 */
export function SpeakerPanel() {
  const { presentation, currentSlideIndex } = usePresentationStore();
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const slide = presentation.slides[currentSlideIndex];
  const nextSlide =
    currentSlideIndex < presentation.slides.length - 1
      ? presentation.slides[currentSlideIndex + 1]
      : null;

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="speaker-panel">
      <div className="speaker-header">
        <span className="speaker-title">Speaker Notes</span>
        <div className="speaker-timer">
          <span className="timer-display">{formatTime(elapsed)}</span>
          <button
            onClick={() => setRunning(!running)}
            className="timer-btn"
          >
            {running ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={() => {
              setElapsed(0);
              setRunning(false);
            }}
            className="timer-btn"
          >
            Reset
          </button>
        </div>
        <span className="speaker-slide-count">
          Slide {currentSlideIndex + 1} / {presentation.slides.length}
        </span>
      </div>
      <div className="speaker-body">
        <div className="speaker-notes-content">
          {slide?.notes ? (
            <p>{slide.notes}</p>
          ) : (
            <p className="no-notes">No notes for this slide</p>
          )}
        </div>
        {nextSlide && (
          <div className="speaker-next">
            <span className="speaker-next-label">Next:</span>
            <div
              className="speaker-next-preview"
              dangerouslySetInnerHTML={{
                __html: nextSlide.bodyHtml || '<p>Empty</p>',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
