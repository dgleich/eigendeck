import { useState, useEffect, useCallback, useRef } from 'react';
import { usePresentationStore } from '../store/presentation';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import type { SlideElement } from '../types/presentation';
import { loadOverlayFor, applyLinkOverlay } from '../lib/useOverlay';
import {
  emptyOverlay, isOverlayEmpty, serializeOverlay, summarizeOverlay, type Overlay,
} from '../lib/notebookOverlay';

const SLIDE_W = 1920;
const SLIDE_H = 1080;

interface Props {
  elementId: string;
  onClose: () => void;
}

// A merge held pending the user's "which recording to keep?" choice. Only
// raised when BOTH sides are notebooks with DIFFERENT non-empty recordings.
interface PendingMerge {
  targetEl: SlideElement;
  sharedLinkId: string;
  sharedSyncId: string;
  targetSlideIdx: number;
  sourceKey: string;
  targetKey: string;
  sourceOv: Overlay;
  targetOv: Overlay;
}

export function LinkOverlay({ elementId, onClose }: Props) {
  const { presentation, currentSlideIndex } = usePresentationStore();
  const [viewIndex, setViewIndex] = useState(Math.max(0, currentSlideIndex - 1));

  const containerRef = useRef<HTMLDivElement>(null);
  const [slideScale, setSlideScale] = useState(0.5);
  const [conflict, setConflict] = useState<PendingMerge | null>(null);

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

  // Commit the link: both elements get the shared link/sync ids and drop any
  // remembered freed-group (_syncId/_linkId) since they're now in a live one.
  const applyLink = useCallback((
    targetEl: SlideElement, sharedLinkId: string, sharedSyncId: string, targetSlideIdx: number,
  ) => {
    const join = (el: SlideElement): SlideElement =>
      ({ ...el, linkId: sharedLinkId, syncId: sharedSyncId, _linkId: undefined, _syncId: undefined } as SlideElement);
    const slides = [...presentation.slides];
    slides[targetSlideIdx] = {
      ...slides[targetSlideIdx],
      elements: slides[targetSlideIdx].elements.map((el) => el.id === targetEl.id ? join(el) : el),
    };
    slides[currentSlideIndex] = {
      ...slides[currentSlideIndex],
      elements: slides[currentSlideIndex].elements.map((el) => el.id === elementId ? join(el) : el),
    };
    usePresentationStore.getState().setPresentation({ ...presentation, slides });
    // Mark dirty manually since setPresentation clears it
    usePresentationStore.setState({ isDirty: true, currentSlideIndex });
    onClose();
  }, [presentation, currentSlideIndex, elementId, onClose]);

  // Move the surviving recording onto the new shared key, then commit the link.
  const reconcileAndLink = useCallback(async (
    p: Omit<PendingMerge, 'sourceOv' | 'targetOv'>, keepKey: string | null,
  ) => {
    await applyLinkOverlay(
      { sourceKey: p.sourceKey, targetKey: p.targetKey, newKey: p.sharedSyncId }, keepKey);
    applyLink(p.targetEl, p.sharedLinkId, p.sharedSyncId, p.targetSlideIdx);
  }, [applyLink]);

  const handleElementClick = useCallback(async (targetEl: SlideElement) => {
    if (!sourceElement) return;
    const sharedLinkId = targetEl.linkId || targetEl._linkId || crypto.randomUUID();
    const sharedSyncId = targetEl.syncId || targetEl._syncId || sharedLinkId;
    const targetSlideIdx = viewIndex;
    // The keys under which each side's recording currently lives.
    const sourceKey = sourceElement.syncId ?? sourceElement.id;
    const targetKey = targetEl.syncId ?? targetEl.id;

    // Only notebooks carry recordings — reconcile them so the merged element
    // keeps exactly one. Non-notebook sides contribute nothing.
    const sourceOv = sourceElement.type === 'notebook' ? await loadOverlayFor(sourceKey) : emptyOverlay();
    const targetOv = targetEl.type === 'notebook' ? await loadOverlayFor(targetKey) : emptyOverlay();
    const sHas = !isOverlayEmpty(sourceOv);
    const tHas = !isOverlayEmpty(targetOv);
    const common = { targetEl, sharedLinkId, sharedSyncId, targetSlideIdx, sourceKey, targetKey };

    if (sHas && tHas && serializeOverlay(sourceOv) !== serializeOverlay(targetOv)) {
      // Two DIFFERENT recordings → can't keep both. Ask which to keep (and
      // warn that the other is discarded). This is the only warning case.
      setConflict({ ...common, sourceOv, targetOv });
      return;
    }
    // 0, 1, or identical recordings → no data loss, no prompt: keep whichever
    // is non-empty (source wins a tie since the contents match).
    await reconcileAndLink(common, sHas ? sourceKey : (tHas ? targetKey : null));
  }, [sourceElement, viewIndex, reconcileAndLink]);

  // Resolve the chooser: keep the picked side's recording, discard the other.
  const finishWithKeep = useCallback((keepKey: string | null) => {
    if (!conflict) return;
    const { sourceOv: _s, targetOv: _t, ...rest } = conflict;
    void _s; void _t;
    setConflict(null);
    void reconcileAndLink(rest, keepKey);
  }, [conflict, reconcileAndLink]);

  if (!sourceElement) { onClose(); return null; }

  // The "which recording to keep?" chooser, shown only on a real conflict.
  if (conflict) {
    const srcSlideNo = currentSlideIndex + 1;
    const tgtSlideNo = conflict.targetSlideIdx + 1;
    return (
      <div className="link-overlay" onClick={() => setConflict(null)}>
        <div className="link-overlay-content" onClick={(e) => e.stopPropagation()}>
          <div className="link-overlay-header">
            <span>Both notebooks have a recording — keep which one? The other is discarded.</span>
            <button className="link-overlay-close" onClick={() => setConflict(null)}>Cancel</button>
          </div>
          <div className="overlay-conflict-choices">
            <button className="overlay-conflict-card" onClick={() => finishWithKeep(conflict.sourceKey)}>
              <strong>This slide (slide {srcSlideNo})</strong>
              <span>{summarizeOverlay(conflict.sourceOv)}</span>
              <em>Keep this recording</em>
            </button>
            <button className="overlay-conflict-card" onClick={() => finishWithKeep(conflict.targetKey)}>
              <strong>Linked slide (slide {tgtSlideNo})</strong>
              <span>{summarizeOverlay(conflict.targetOv)}</span>
              <em>Keep this recording</em>
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            {viewSlide.elements.map((el) => (
              <LinkableElement
                key={el.id}
                element={el}
                isLinked={!!(sourceElement.linkId && el.linkId === sourceElement.linkId)}
                onClick={() => handleElementClick(el)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkableElement({ element: el, isLinked, onClick }: {
  element: SlideElement; isLinked: boolean; onClick: () => void;
}) {
  const p = el.position;
  const config = usePresentationStore.getState().presentation.config;

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: p.x, top: p.y, width: p.width, height: p.height,
    cursor: 'pointer',
    border: isLinked ? '4px solid #16a34a' : '4px solid transparent',
    borderRadius: 4,
    transition: 'border-color 0.15s',
    zIndex: 10,
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
        <div style={{ ...wrapStyle, background: '#e8f4f8', border: isLinked ? '4px solid #16a34a' : '4px dashed #93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#60a5fa' }}
          onClick={onClick} className="link-overlay-element">
          DEMO
        </div>
      );
    case 'demo-piece':
      return (
        <div style={{ ...wrapStyle, background: '#f0e8f8', border: isLinked ? '4px solid #16a34a' : '4px dashed #a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#7c3aed' }}
          onClick={onClick} className="link-overlay-element">
          {el.piece}
        </div>
      );
    case 'cover':
      return (
        <div style={{ ...wrapStyle, background: el.color || '#fff', border: isLinked ? '4px solid #16a34a' : '4px solid #ddd' }}
          onClick={onClick} className="link-overlay-element" />
      );
    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      // Use bounding box for click target
      const pad = 30;
      const bx = Math.min(x1, x2) - pad;
      const by = Math.min(y1, y2) - pad;
      const bw = Math.abs(x2 - x1) + pad * 2;
      const bh = Math.abs(y2 - y1) + pad * 2;
      return (
        <div style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, cursor: 'pointer', zIndex: 10 }}
          onClick={onClick} className="link-overlay-element">
          <svg width={bw} height={bh} style={{ overflow: 'visible' }}>
            <line x1={x1 - bx} y1={y1 - by} x2={x2 - bx} y2={y2 - by}
              stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke' }} />
            <line x1={x1 - bx} y1={y1 - by} x2={x2 - bx} y2={y2 - by}
              stroke={color} strokeWidth={strokeWidth} />
            <polygon points={`${x2 - bx},${y2 - by} ${x2 - bx - headSize * Math.cos(angle - ha)},${y2 - by - headSize * Math.sin(angle - ha)} ${x2 - bx - headSize * Math.cos(angle + ha)},${y2 - by - headSize * Math.sin(angle + ha)}`} fill={color} />
          </svg>
          {isLinked && <div style={{ position: 'absolute', inset: 0, border: '4px solid #16a34a', borderRadius: 4 }} />}
        </div>
      );
    }
  }
}
