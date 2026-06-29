import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';
import { resolveTheme } from '../lib/themes';
import { SpeakerPanel } from './SpeakerView';
import { getSlideNumber } from '../types/presentation';
import type { SlideElement } from '../types/presentation';
// Live-present element rendering is shared with the projector window
// (src/presenter.tsx) via PresentSlide — one renderer, no drift.
import { PresentElement, PresentControllerIframe, type PresentCtx } from './PresentSlide';
import { planPresentTransition } from '../lib/presentTransition';

const TRANSITION_MS = 300;

/**
 * The single live presentation viewer — used by BOTH the single-window present
 * (main window, self-navigated) AND the projector window (src/presenter.tsx,
 * navigated externally via `controlledIndex`). Same transitions, same
 * rendering, no drift.
 *
 * - Uncontrolled (no `controlledIndex`): owns navigation + keyboard, Escape
 *   exits present mode.
 * - Controlled (`controlledIndex` set): index comes from the prop (the speaker
 *   window's events). Keyboard nav still WORKS here, but instead of moving a
 *   local index it forwards the target slide to the owner via `onNavigate` (the
 *   projector tells the speaker window, which navigates and echoes back) — so a
 *   clicker/keyboard focused on the projector drives the deck too. Escape calls
 *   `onExit` (close the projector window).
 */
export function PresentMode({ controlledIndex, onExit, onNavigate }: {
  controlledIndex?: number; onExit?: () => void; onNavigate?: (index: number) => void;
} = {}) {
  const { presentation, setPresenting, selectSlide } =
    usePresentationStore();
  const controlled = controlledIndex !== undefined;
  const [localIndex, setLocalIndex] = useState(
    usePresentationStore.getState().currentSlideIndex
  );
  const currentIndex = controlled ? controlledIndex! : localIndex;
  const [showSpeaker, setShowSpeaker] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Animation state
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const animTimerRef = useRef<number | null>(null);

  // Zoom-into-slide (#29): scale the slide wrapper around a focal point; the
  // mouse pans while zoomed. `focus` is normalized [0,1] over the viewport.
  const ZOOM_LEVEL = 2.2;
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const toggleZoom = useCallback(() => setZoom((z) => (z > 1 ? 1 : ZOOM_LEVEL)), []);
  const zoomOut = useCallback(() => setZoom(1), []);
  const shownIndexRef = useRef(currentIndex);

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

  // Run the slide-change transition whenever the index changes — for LOCAL
  // navigation AND for the controlled prop (projector), so both windows
  // animate identically.
  //
  // useLayoutEffect (NOT useEffect): it runs after render but BEFORE the
  // browser paints. The render right after an index change still has the new
  // elements at opacity 1 (prevIndex is null); if we set the "entering" state
  // in a post-paint useEffect, that opacity-1 frame PAINTS first → the slide
  // pops into view, then jumps to 0 and fades in. Setting prevIndex/animating
  // here re-renders to opacity 0 before paint, so the first painted frame is
  // already the start of the fade — no pop.
  useLayoutEffect(() => {
    const prev = shownIndexRef.current;
    if (prev === currentIndex) return;
    shownIndexRef.current = currentIndex;
    // #29: a new slide always starts un-zoomed and re-centered — a focal point
    // from the previous slide is meaningless on the next, and in controlled
    // (projector) mode each window owns its zoom, so leaving it set desyncs the
    // projector from the speaker view.
    setZoom(1);
    setFocus({ x: 0.5, y: 0.5 });
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setPrevIndex(prev);
    setAnimating(false);
    const raf = requestAnimationFrame(() => {
      setAnimating(true);
      animTimerRef.current = window.setTimeout(() => {
        setAnimating(false);
        setPrevIndex(null);
        animTimerRef.current = null;
      }, TRANSITION_MS);
    });
    return () => cancelAnimationFrame(raf);
  }, [currentIndex]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalSlides) return;
      if (index === currentIndex) return;
      if (controlled) {
        // Projector window: we don't own the index. Forward the request to the
        // main (speaker) window, which navigates and echoes presenter:goto back.
        onNavigate?.(index);
        return;
      }
      setLocalIndex(index);
      selectSlide(index);
    },
    [controlled, currentIndex, totalSlides, selectSlide, onNavigate]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: zoom out first if zoomed in (#29); else exit present / close the
      // projector window. Functional update reads the live zoom without a dep.
      if (e.key === 'Escape') {
        let wasZoomed = false;
        setZoom((z) => { wasZoomed = z > 1; return 1; });
        if (wasZoomed) return;
        if (onExit) onExit(); else setPresenting(false); return;
      }
      // NOTE: controlled (projector) windows still navigate via the keyboard —
      // goTo() forwards the target to the speaker window when controlled.
      // When focus is in a text-entry context (a notebook code cell's
      // CodeMirror editor, an input, etc.), let it handle the key —
      // otherwise Space/arrows get hijacked for slide navigation and
      // the presenter can't type a space into a live cell.
      const t = e.target as HTMLElement | null;
      const inEditor = !!t && (
        t.isContentEditable ||
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
        !!t.closest?.('.cm-editor')
      );
      if (inEditor) return;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
          e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          e.preventDefault(); goPrev(); break;
        case 's': case 'S':
          // Inline speaker panel only makes sense in the single-window present.
          if (!controlled) { e.preventDefault(); setShowSpeaker((prev) => !prev); }
          break;
        case 'z': case 'Z': e.preventDefault(); toggleZoom(); break;   // #29: zoom into the slide
        case 'Home': e.preventDefault(); goTo(0); break;
        case 'End': e.preventDefault(); goTo(totalSlides - 1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goTo, totalSlides, setPresenting, controlled, onExit, toggleZoom]);

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
  const ctx: PresentCtx = { slide, presentationConfig: presentation.config, presentationTheme: presentation.theme };

  // The transition plan: every current element with its true z-order and role
  // (static / fade / linked), plus the elements leaving. Pure + unit-tested
  // (src/lib/presentTransition.ts); rendered as ONE stable list keyed by id, so
  // iframes never remount and z-order stays correct. See
  // docs/presenter-architecture.md.
  const plan = planPresentTransition(prevSlide, slide);

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div
        className="present-viewport"
        ref={viewportRef}
        style={zoom > 1 ? { position: 'relative' } : undefined}
      >
        <div
          className="present-slide-wrapper"
          style={{
            width: slideW * scale, height: slideH * scale,
            transform: zoom > 1 ? `scale(${zoom})` : undefined,
            transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
            transition: 'transform 0.25s ease',
          }}
        >
          <div
            className="present-slide"
            style={{ width: slideW, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left',
              backgroundColor: resolveTheme(presentation.theme, slide.theme).background }}
          >
            {/* Elements LEAVING (on the previous slide, linked but no match on
                this one) — fade out. Transient; rendered separately because they
                aren't in the current slide's element list. */}
            {plan.fadeOut.map(({ element: el, z }) => (
              <PresentElement
                key={`fadeout-${el.id}`}
                element={el}
                zIndex={z}
                ctx={ctx}
                style={{
                  opacity: animating ? 0 : 1,
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* ALL current-slide elements in ONE list, keyed by el.id in true
                z-order. Critically, an element NEVER changes its key or its
                position in the tree across the transition (entering → settled),
                so iframes (demo / video / notebook) are never unmounted and
                re-created — that remount is what made HTML demos blank for one
                frame as they finished fading ("flash"). The per-element style
                encodes its transition role:
                  • linked (matched partner on prev slide) → animate position
                  • cover / synced-from-prev → static (instant, no fade)
                  • genuinely new → fade in */}
            {plan.items.map(({ element: el, z, role, from }) => {
              // Linked arrow → interpolate its endpoints (or static if unmoved).
              if (role === 'linked' && from && el.type === 'arrow' && from.type === 'arrow') {
                const moved = !(from.x1 === el.x1 && from.y1 === el.y1 &&
                  from.x2 === el.x2 && from.y2 === el.y2);
                if (moved) {
                  return (
                    <AnimatedArrow key={el.id} from={from} to={el} zIndex={z}
                      animating={animating} hasPrev={prevIndex !== null} />
                  );
                }
                return <PresentElement key={el.id} element={el} zIndex={z} ctx={ctx} />;
              }

              // Linked (non-arrow) → animate position/size from the prev partner.
              if (role === 'linked' && from) {
                const fromPos = getElementBounds(from);
                const toPos = getElementBounds(el);
                const isStatic = fromPos.x === toPos.x && fromPos.y === toPos.y &&
                  fromPos.w === toPos.w && fromPos.h === toPos.h;
                return (
                  <PresentElement
                    key={el.id}
                    element={el}
                    zIndex={z}
                    ctx={ctx}
                    style={isStatic ? {} : (prevIndex !== null ? {
                      left: animating ? toPos.x : fromPos.x,
                      top: animating ? toPos.y : fromPos.y,
                      width: animating ? toPos.w : fromPos.w,
                      height: animating ? toPos.h : fromPos.h,
                      transition: animating ? `left ${TRANSITION_MS}ms ease-in-out, top ${TRANSITION_MS}ms ease-in-out, width ${TRANSITION_MS}ms ease-in-out, height ${TRANSITION_MS}ms ease-in-out, opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                    } : {})}
                  />
                );
              }

              // role 'static' (cover / carried-over) → instant; 'fade' → fade in.
              return (
                <PresentElement
                  key={el.id}
                  element={el}
                  zIndex={z}
                  ctx={ctx}
                  style={role === 'static' ? { opacity: 1 } : {
                    opacity: prevIndex !== null ? (animating ? 1 : 0) : 1,
                    transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                  }}
                />
              );
            })}

            {/* Hidden controller iframes for demo-piece elements,
                deduped by assetId. */}
            {(() => {
              const controllers = new Set<string>();
              for (const el of slide.elements) {
                if (el.type !== 'demo-piece') continue;
                controllers.add(el.assetId);
              }
              return Array.from(controllers).map((assetId) => (
                <PresentControllerIframe key={`controller-${assetId}`} assetId={assetId} />
              ));
            })()}

            {/* Footer */}
            <div className="slide-footer" style={{ zIndex: 1000 }}>
              <span className="slide-footer-meta">{meta}</span>
              <span className="slide-footer-number">{getSlideNumber(presentation.slides, currentIndex)}</span>
            </div>
          </div>
        </div>
        {/* #29 — while zoomed, a transparent overlay above ALL slide content
            (including demo/video/notebook iframes, whose events don't bubble to
            the parent) drives pan + click-to-zoom-out. Without it, the cursor
            and clicks die over an iframe and pan freezes on demo-heavy slides.
            The tradeoff — you can't interact with a demo while zoomed — is
            intended: zoom is an inspect gesture. */}
        {zoom > 1 && (
          <div
            className="present-zoom-pan"
            style={{ position: 'absolute', inset: 0, cursor: 'zoom-out', zIndex: 1500 }}
            onClick={() => zoomOut()}
            onMouseMove={(e) => {
              // Map the cursor into the WRAPPER's centered layout box (not the raw
              // viewport) so the focal point is letterbox-correct — transform-origin %
              // is relative to the wrapper, and the viewport flex-centers it, so a
              // window whose aspect ≠ the slide's has bars we must subtract. (#29)
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const ww = slideW * scale, wh = slideH * scale;
              const ox = (r.width - ww) / 2, oy = (r.height - wh) / 2;   // letterbox offset
              const clamp = (v: number) => Math.max(0, Math.min(1, v));
              setFocus({ x: clamp((e.clientX - r.left - ox) / ww), y: clamp((e.clientY - r.top - oy) / wh) });
            }}
          />
        )}
      </div>
      {showSpeaker && <SpeakerPanel />}
      {/* #29 — press to zoom into the slide; mouse pans while zoomed (also 'Z' / Esc) */}
      <button
        className="present-zoom-btn"
        onClick={toggleZoom}
        title={zoom > 1 ? 'Zoom out (Z / Esc)' : 'Zoom in (Z)'}
        aria-label={zoom > 1 ? 'Zoom out' : 'Zoom in'}
        style={{
          position: 'absolute', right: 18, bottom: 18, zIndex: 2000,
          width: 44, height: 44, borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(0,0,0,0.45)',
          color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer',
          opacity: 0.55, transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.55'; }}
      >{zoom > 1 ? '−' : '+'}</button>
    </div>
  );
}

// ============================================
// Compute linked object transitions
// ============================================

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
// Animated arrow — interpolates x1/y1/x2/y2 via rAF
// ============================================

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

type ArrowEl = Extract<SlideElement, { type: 'arrow' }>;

function AnimatedArrow({ from, to, zIndex, animating, hasPrev }: {
  from: ArrowEl; to: ArrowEl; zIndex: number; animating: boolean; hasPrev: boolean;
}) {
  const [coords, setCoords] = useState({
    x1: hasPrev ? from.x1 : to.x1,
    y1: hasPrev ? from.y1 : to.y1,
    x2: hasPrev ? from.x2 : to.x2,
    y2: hasPrev ? from.y2 : to.y2,
  });
  const animRef = useRef<number | null>(null);
  const startTime = useRef(0);

  useEffect(() => {
    if (!animating || !hasPrev) {
      setCoords({ x1: to.x1, y1: to.y1, x2: to.x2, y2: to.y2 });
      return;
    }

    startTime.current = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime.current;
      const t = Math.min(elapsed / TRANSITION_MS, 1);
      const e = easeInOut(t);

      setCoords({
        x1: from.x1 + (to.x1 - from.x1) * e,
        y1: from.y1 + (to.y1 - from.y1) * e,
        x2: from.x2 + (to.x2 - from.x2) * e,
        y2: from.y2 + (to.y2 - from.y2) * e,
      });

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    // Start from the 'from' position
    setCoords({ x1: from.x1, y1: from.y1, x2: from.x2, y2: from.y2 });
    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [animating, hasPrev, from.x1, from.y1, from.x2, from.y2, to.x1, to.y1, to.x2, to.y2]);

  const { x1, y1, x2, y2 } = coords;
  const color = to.color || '#e53e3e';
  const strokeWidth = to.strokeWidth || 4;
  const headSize = to.headSize || 16;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ha = Math.PI / 6;

  return (
    <svg style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex,
    }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
      <polygon points={`${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}`} fill={color} />
    </svg>
  );
}
