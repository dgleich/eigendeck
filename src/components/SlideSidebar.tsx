import { useRef, useState, useCallback, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import { getSlideNumber, isGroupChild, type SlideElement } from '../types/presentation';
import { resolveTheme } from '../lib/themes';
import { TextElementSvg } from './TextElementSvg';
import { useRenderedAsset } from '../lib/assetRenderer';
import { ASSET_TIER } from '../lib/assetCache';
import { useAssetFileWatcher } from '../lib/assetWatcher';
import type { MenuEntry } from './ContextMenu';
import { ElementPreviewImg } from './ElementPreviewImg';

/**
 * Thumbnail-tier image cell for the sidebar. Pulls a cached 256-px PNG from
 * asset_cache (rendering on first display); falls back to a "loading" tile
 * while the render is in flight and a plain "IMG" placeholder if no source.
 * Same code path serves raster + svg + (future) pdf via ImageElement.kind.
 */
function SidebarImageThumb({ element }: { element: Extract<SlideElement, { type: 'image' }> }) {
  const p = element.position;
  const kind = element.kind ?? 'raster';
  const url = useRenderedAsset(element.assetId, kind, ASSET_TIER.thumb, ASSET_TIER.thumb, element.snapshotVariant);
  // Auto-reload the asset when the user re-saves its source file on disk.
  // No-op when the asset wasn't drag/picker-inserted (no external link).
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
      overflow: 'hidden',
      background: url ? 'transparent' : '#f0f0f0',
      border: url ? 'none' : '1px solid #ddd', borderRadius: 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <span style={{ fontSize: 24, color: '#aaa' }}>IMG</span>
      )}
    </div>
  );
}

/** Demo placeholder in the sidebar. Renders a labeled tile and
 *  ALSO subscribes the file watcher for the demo's external_path.
 *  Without the hook call, demo assets with external_path set would
 *  never get watched — useAssetFileWatcher subscriptions live in
 *  the components that mount the element. */
function SidebarDemoTile({ element }: { element: Extract<SlideElement, { type: 'demo' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
      overflow: 'hidden', background: '#fff',
    }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 20,
          color: '#60a5fa', background: '#e8f4f8', border: '1px dashed #93c5fd' }}>DEMO</div>
      } />
    </div>
  );
}

/** Demo-piece placeholder — same subscribe-then-render pattern. */
function SidebarDemoPieceTile({ element }: { element: Extract<SlideElement, { type: 'demo-piece' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
      overflow: 'hidden', background: '#fff',
    }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 16,
          color: '#7c3aed', background: '#f0e8f8', border: '1px dashed #a78bfa' }}>{element.piece}</div>
      } />
    </div>
  );
}

/** Video thumbnail — shows the cached poster-frame preview, and subscribes the
 *  file watcher for the video's external file so it reloads on disk changes. */
function SidebarVideoTile({ element }: { element: Extract<SlideElement, { type: 'video' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
      overflow: 'hidden', background: '#000',
    }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 18,
          color: '#fff', background: '#1f2937' }}>▶</div>
      } />
    </div>
  );
}

/** Notebook thumbnail — shows the cached preview image, and (crucially)
 *  subscribes the file watcher for the notebook's external .ipynb so it
 *  auto-reloads on disk changes. Like images/demos, the watcher lives in the
 *  always-rendered sidebar thumb, so it covers notebooks on every slide. */
function SidebarNotebookThumb({ element }: { element: Extract<SlideElement, { type: 'notebook' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
      overflow: 'hidden', background: '#fff',
    }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 64,
          color: '#86c986', background: '#eef7ee' }}>NB</div>
      } />
    </div>
  );
}

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;
const THUMB_WIDTH = 166;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE;

export function SlideSidebar() {
  const {
    presentation,
    currentSlideIndex,
    selectSlide,
    addSlide,
    deleteSlide,
    duplicateSlide,
    moveSlide,
  } = usePresentationStore();

  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  // Scroll the active slide into view when currentSlideIndex changes
  useEffect(() => {
    if (!containerRef.current) return;
    const thumbs = containerRef.current.querySelectorAll('.slide-thumbnail');
    const active = thumbs[currentSlideIndex] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentSlideIndex]);

  const handleContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging === null) return;
      const thumbs = containerRef.current?.querySelectorAll('.slide-thumbnail');
      if (!thumbs) return;
      let found = false;
      for (let i = 0; i < thumbs.length; i++) {
        const rect = thumbs[i].getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom && i !== dragging) {
          setDropTarget(i); found = true; break;
        }
      }
      if (!found) setDropTarget(null);
    },
    [dragging]
  );

  const handleContainerPointerUp = useCallback(() => {
    if (dragging !== null && dropTarget !== null && dragging !== dropTarget) moveSlide(dragging, dropTarget);
    if (dragging !== null) {
      // Clear any text selection that happened during drag
      window.getSelection()?.removeAllRanges();
    }
    setDragging(null); setDropTarget(null);
  }, [dragging, dropTarget, moveSlide]);

  return (
    <div className="sidebar">
      <div
        className={`sidebar-slides${dragging !== null ? ' is-dragging' : ''}`}
        ref={containerRef}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        onPointerLeave={() => { if (dragging !== null) { setDragging(null); setDropTarget(null); } }}
      >
        {presentation.slides.map((slide, index) => {
          const child = isGroupChild(presentation.slides, index);
          const slideNum = getSlideNumber(presentation.slides, index);
          return (
          <div
            key={slide.id}
            className={`slide-thumbnail${index === currentSlideIndex ? ' active' : ''}${dropTarget === index ? ' drag-over' : ''}${dragging === index ? ' dragging' : ''}${child ? ' group-child' : ''}${slide.groupId ? ' in-group' : ''}`}
            onClick={() => { if (dragging === null) selectSlide(index); }}
            onContextMenu={(e) => {
              e.preventDefault();
              selectSlide(index);
              const store = usePresentationStore.getState();
              const items: MenuEntry[] = [
                { label: 'Duplicate Slide', shortcut: 'D', onClick: () => duplicateSlide(index) },
                { label: 'Add Build Slide', onClick: () => store.addBuildSlide() },
                { separator: true },
                { label: 'Delete Slide', shortcut: 'X', onClick: () => deleteSlide(index), disabled: presentation.slides.length <= 1 },
              ];
              window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('.slide-actions')) return;
              startY.current = e.clientY;
              const idx = index;
              const onMove = (me: PointerEvent) => { if (Math.abs(me.clientY - startY.current) > 8) setDragging(idx); };
              const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
              window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
            }}
          >
            <span className="slide-number">{child ? '' : slideNum}</span>
            <div className="slide-thumb-clip" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
              <div
                className="slide-thumb-render"
                style={{
                  width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
                  transform: `scale(${THUMB_SCALE})`, transformOrigin: 'top left',
                  position: 'relative', background: resolveTheme(presentation.theme, slide.theme).background,
                }}
              >
                {/* Elements */}
                {slide.elements.map((el) => {
                  const p = el.position;
                  switch (el.type) {
                    case 'text':
                      return (
                        <TextElementSvg key={el.id}
                          element={el} slide={slide}
                          presentationTheme={presentation.theme}
                          presentationConfig={presentation.config} />
                      );
                    case 'image':
                      return <SidebarImageThumb key={el.id} element={el} />;
                    case 'arrow': {
                      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 3 } = el;
                      return (
                        <svg key={el.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
                        </svg>
                      );
                    }
                    case 'demo':
                      return <SidebarDemoTile key={el.id} element={el} />;
                    case 'demo-piece':
                      return <SidebarDemoPieceTile key={el.id} element={el} />;
                    case 'notebook':
                      return <SidebarNotebookThumb key={el.id} element={el} />;
                    case 'video':
                      return <SidebarVideoTile key={el.id} element={el} />;
                    case 'cover':
                      return (
                        <div key={el.id} style={{
                          position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
                          background: el.color || '#fff', border: '1px solid #ddd',
                        }} />
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
            <div className="slide-actions">
              <button onClick={(e) => { e.stopPropagation(); duplicateSlide(index); }} title="Duplicate">D</button>
              <button onClick={(e) => { e.stopPropagation(); if (presentation.slides.length > 1 && confirm('Delete this slide?')) deleteSlide(index); }} title="Delete">X</button>
            </div>
          </div>
          );
        })}
      </div>
      <button className="btn-add-slide" onClick={addSlide} title="Add a new slide after the current one">+ Add Slide</button>
    </div>
  );
}
