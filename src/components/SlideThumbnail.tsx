// Canonical STATIC slide render — the shared "frozen snapshot" of a slide used
// by the sidebar thumbnails AND the dual-monitor speaker view. Static (not
// live): heavy elements (demo / notebook / video) show cached preview images
// rather than live iframes, so you can render many of these cheaply (a whole
// sidebar, or the speaker's current+next). Text/math reuse TextElementSvg, the
// same pipeline the editor and present view use.
//
// This is the C-renderer in the present-architecture split (see PresentSlide.tsx
// for the B-renderer, the LIVE present view). Live vs static are deliberately
// separate: you can't run live demo iframes in a 50-slide sidebar.

import { resolveTheme } from '../lib/themes';
import { TextElementSvg } from './TextElementSvg';
import { useRenderedAsset } from '../lib/assetRenderer';
import { ASSET_TIER } from '../lib/assetCache';
import { useAssetFileWatcher } from '../lib/assetWatcher';
import { ElementPreviewImg } from './ElementPreviewImg';
import { VideoThumb } from './VideoThumb';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;

/** A static, scaled snapshot of one slide, `width` px wide. */
export function SlideThumbnail({ presentation, slide, width }: {
  presentation: Presentation; slide: Slide; width: number;
}) {
  const scale = width / SLIDE_WIDTH;
  const height = SLIDE_HEIGHT * scale;
  return (
    <div className="slide-thumb-clip" style={{ width, height }}>
      <div className="slide-thumb-render" style={{
        width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
        transform: `scale(${scale})`, transformOrigin: 'top left',
        position: 'relative', background: resolveTheme(presentation.theme, slide.theme).background,
      }}>
        {slide.elements.map((el) => (
          <ThumbElement key={el.id} element={el} slide={slide} presentation={presentation} />
        ))}
      </div>
    </div>
  );
}

function ThumbElement({ element: el, slide, presentation }: {
  element: SlideElement; slide: Slide; presentation: Presentation;
}) {
  const p = el.position;
  switch (el.type) {
    case 'text':
      return (
        <TextElementSvg element={el} slide={slide}
          presentationTheme={presentation.theme} presentationConfig={presentation.config} />
      );
    case 'image':
      return <ThumbImage element={el} />;
    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 3 } = el;
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
        </svg>
      );
    }
    case 'demo':
      return <ThumbDemo element={el} />;
    case 'demo-piece':
      return <ThumbDemoPiece element={el} />;
    case 'notebook':
      return <ThumbNotebook element={el} />;
    case 'video':
      return <ThumbVideo element={el} />;
    case 'cover':
      return (
        <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, background: el.color || '#fff', border: '1px solid #ddd' }} />
      );
    default:
      return null;
  }
}

function ThumbImage({ element }: { element: Extract<SlideElement, { type: 'image' }> }) {
  const p = element.position;
  const kind = element.kind ?? 'raster';
  const url = useRenderedAsset(element.assetId, kind, ASSET_TIER.thumb, ASSET_TIER.thumb, element.snapshotVariant);
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden',
      background: url ? 'transparent' : '#f0f0f0', border: url ? 'none' : '1px solid #ddd', borderRadius: 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : <span style={{ fontSize: 24, color: '#aaa' }}>IMG</span>}
    </div>
  );
}

function ThumbDemo({ element }: { element: Extract<SlideElement, { type: 'demo' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden', background: '#fff' }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#60a5fa', background: '#e8f4f8', border: '1px dashed #93c5fd' }}>DEMO</div>
      } />
    </div>
  );
}

function ThumbDemoPiece({ element }: { element: Extract<SlideElement, { type: 'demo-piece' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden', background: '#fff' }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#7c3aed', background: '#f0e8f8', border: '1px dashed #a78bfa' }}>{element.piece}</div>
      } />
    </div>
  );
}

function ThumbVideo({ element }: { element: Extract<SlideElement, { type: 'video' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  useAssetFileWatcher(element.captionsAssetId, element.id);
  return (
    <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden', background: '#000' }}>
      <VideoThumb element={element} />
    </div>
  );
}

function ThumbNotebook({ element }: { element: Extract<SlideElement, { type: 'notebook' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden', background: '#fff' }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, color: '#86c986', background: '#eef7ee' }}>NB</div>
      } />
    </div>
  );
}
