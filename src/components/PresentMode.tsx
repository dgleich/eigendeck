import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';
import { resolveTheme } from '../lib/themes';
import { SpeakerPanel } from './SpeakerView';
import { getSlideNumber } from '../types/presentation';
import type { Slide, SlideElement } from '../types/presentation';
// Live-present element rendering is shared with the projector window
// (src/presenter.tsx) via PresentSlide — one renderer, no drift.
import { PresentElement, PresentControllerIframe, type PresentCtx } from './PresentSlide';

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
      // Escape: exit present (main) or close the projector window (controlled).
      if (e.key === 'Escape') { if (onExit) onExit(); else setPresenting(false); return; }
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
        case 'Home': e.preventDefault(); goTo(0); break;
        case 'End': e.preventDefault(); goTo(totalSlides - 1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goTo, totalSlides, setPresenting, controlled, onExit]);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  const slide = presentation.slides[currentIndex];
  if (!slide) return null;

  const prevSlide = prevIndex !== null ? presentation.slides[prevIndex] : null;
  // Element ids present on the previous slide too. A SYNCED element (one element
  // shown on several slides \u2014 same id, no linkId) must stay STATIC across the
  // transition: it's literally the same element, so fading it in/out each step
  // makes it flicker ("wiggle") between consecutive slides of a build.
  const prevIds = new Set(prevSlide ? prevSlide.elements.map((e) => e.id) : []);
  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');
  const ctx: PresentCtx = { slide, presentationConfig: presentation.config, presentationTheme: presentation.theme };

  // Diff linked elements between prev and current slide
  const linkedTransitions = computeLinkedTransitions(prevSlide, slide);

  // z-index MUST come from the element's TRUE slide z-order (its index in
  // slide.elements), NOT from a per-bucket counter. Otherwise a linked element
  // (fadeIn/linked bucket) and its unlinked slide-mates get z from different
  // bucket ranges, so stacking is wrong DURING the transition and then snaps
  // when everything collapses to one bucket at settle — the "image on top, then
  // jumps behind the title" glitch (a linked title sat below its unlinked image
  // mid-transition). Keyed by id; fall back to prev-slide order for fade-outs.
  const zOrder = new Map(slide.elements.map((e, i) => [e.id, i]));
  const prevZOrder = new Map((prevSlide?.elements ?? []).map((e, i) => [e.id, i]));
  const zOf = (id: string) => zOrder.get(id) ?? 0;
  const prevZOf = (id: string) => prevZOrder.get(id) ?? 0;

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div className="present-viewport" ref={viewportRef}>
        <div className="present-slide-wrapper" style={{ width: slideW * scale, height: slideH * scale }}>
          <div
            className="present-slide"
            style={{ width: slideW, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left',
              backgroundColor: resolveTheme(presentation.theme, slide.theme).background }}
          >
            {/* Fading out elements (from previous slide, no match in current) */}
            {linkedTransitions.fadeOut.map((el) => (
              <PresentElement
                key={`fadeout-${el.id}`}
                element={el}
                zIndex={prevZOf(el.id)}
                ctx={ctx}
                style={{
                  opacity: animating ? 0 : 1,
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* Linked elements that animate position/size */}
            {linkedTransitions.linked.map(({ from, to }) => {
              // Arrows: interpolate coordinates via rAF
              if (from.type === 'arrow' && to.type === 'arrow') {
                // If arrow hasn't moved, render statically
                const arrowStatic = from.x1 === to.x1 && from.y1 === to.y1 &&
                  from.x2 === to.x2 && from.y2 === to.y2;
                if (arrowStatic) {
                  return (
                    <PresentElement key={`linked-${to.id}`} element={to} zIndex={zOf(to.id)}
                      ctx={ctx} />
                  );
                }
                return (
                  <AnimatedArrow
                    key={`linked-arrow-${to.id}`}
                    from={from}
                    to={to}
                    zIndex={zOf(to.id)}
                    animating={animating}
                    hasPrev={prevIndex !== null}
                  />
                );
              }

              const displayEl = to;
              const fromPos = getElementBounds(from);
              const toPos = getElementBounds(to);

              // If position hasn't changed, render statically — no transition, no flicker
              const isStatic = fromPos.x === toPos.x && fromPos.y === toPos.y &&
                fromPos.w === toPos.w && fromPos.h === toPos.h;

              return (
                <PresentElement
                  key={`linked-${to.id}`}
                  element={displayEl}
                  zIndex={zOf(to.id)}
                  ctx={ctx}
                  style={isStatic ? {} : {
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

            {/* Fading in elements (new in current slide, no match in previous).
                Cover elements are masks for progressive reveals — they must
                appear INSTANTLY (a fading cover defeats the reveal). */}
            {linkedTransitions.fadeIn.map((el) => (
              <PresentElement
                key={`fadein-${el.id}`}
                element={el}
                zIndex={zOf(el.id)}
                ctx={ctx}
                style={el.type === 'cover' ? { opacity: 1 } : {
                  opacity: animating ? 1 : (prevIndex !== null ? 0 : 1),
                  transition: animating ? `opacity ${TRANSITION_MS}ms ease-in-out` : undefined,
                }}
              />
            ))}

            {/* Unlinked elements (no linkId, current slide only). Two cases
                render STATIC (opacity 1, no fade): cover masks (so a reveal
                doesn't flash its hidden content while the cover fades in), and
                SYNCED elements that were also on the previous slide (same id —
                fading them would flicker the shared element between build steps). */}
            {linkedTransitions.unlinked.map((el) => {
              const isStatic = el.type === 'cover' || prevIds.has(el.id);
              return (
                <PresentElement
                  key={el.id}
                  element={el}
                  zIndex={zOf(el.id)}
                  ctx={ctx}
                  style={isStatic ? { opacity: 1 } : {
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
