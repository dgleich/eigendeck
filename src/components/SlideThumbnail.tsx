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

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowGlyph } from './ArrowGlyph';
import { CoverView } from './ElementView';
import { describeCover, describeArrow } from '../lib/elementDescriptor.mjs';
import { htmlElementSrcdoc, HTML_SANDBOX_LOCKED, htmlIsScaled, htmlScaleLayout } from '../lib/htmlElement.mjs';
import { ELEMENT_PLACEHOLDERS as PH } from '../lib/elementPlaceholders.mjs';
import { resolveTheme } from '../lib/themes';
import { imageVisualStyle } from '../lib/imageVisualStyle';
import { TextElementSvg } from './TextElementSvg';
import { useRenderedAsset } from '../lib/assetRenderer';
import { ASSET_TIER } from '../lib/assetCache';
import { useAssetFileWatcher } from '../lib/assetWatcher';
import { ElementPreviewImg } from './ElementPreviewImg';
import { VideoThumb } from './VideoThumb';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

/**
 * A static, scaled snapshot of one slide.
 *
 * - Pass `width` (px) for a FIXED-size thumbnail (the sidebar, whose column is a
 *   known width).
 * - Omit `width` for a RESPONSIVE thumbnail that fills its parent's width and
 *   takes the deck's aspect ratio (the speaker view). This avoids the
 *   fixed-width-inside-a-flex-box mismatch that clipped the next-slide preview.
 *
 * `imageTier` is the max px (long edge) raster images render at; defaults to the
 * small sidebar thumb tier. The speaker view passes ASSET_TIER.full so the
 * current/next previews use crisp, slide-native images instead of 256px ones.
 */
export function SlideThumbnail({ presentation, slide, width, imageTier = ASSET_TIER.thumb }: {
  presentation: Presentation; slide: Slide; width?: number; imageTier?: number;
}) {
  const slideW = presentation.config.width || 1920;
  const slideH = presentation.config.height || 1080;

  // Responsive mode measures the rendered width; fixed mode uses the prop.
  const ref = useRef<HTMLDivElement>(null);
  const [measuredW, setMeasuredW] = useState(0);
  useLayoutEffect(() => {
    if (width !== undefined) return; // fixed-size: no observer needed
    const el = ref.current;
    if (!el) return;
    setMeasuredW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setMeasuredW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const renderW = width !== undefined ? width : measuredW;
  const scale = renderW / slideW;
  // Fixed: explicit box. Responsive: fill width, height from the deck ratio
  // (set even before measuring so the box doesn't collapse on first paint).
  const outerStyle: React.CSSProperties = width !== undefined
    ? { width, height: slideH * scale }
    : { width: '100%', aspectRatio: `${slideW} / ${slideH}` };

  return (
    <div ref={ref} className="slide-thumb-clip" style={{ ...outerStyle, position: 'relative' }}>
      {renderW > 0 && (
        <div className="slide-thumb-render" style={{
          width: slideW, height: slideH,
          transform: `scale(${scale})`, transformOrigin: 'top left',
          position: 'absolute', top: 0, left: 0,
          background: resolveTheme(presentation.theme, slide.theme).background,
        }}>
          {slide.elements.map((el) => (
            <ThumbElement key={el.id} element={el} slide={slide} presentation={presentation} imageTier={imageTier} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbElement({ element: el, slide, presentation, imageTier }: {
  element: SlideElement; slide: Slide; presentation: Presentation; imageTier: number;
}) {
  switch (el.type) {
    case 'text':
      return (
        <TextElementSvg element={el} slide={slide}
          presentationTheme={presentation.theme} presentationConfig={presentation.config} />
      );
    case 'image':
      return <ThumbImage element={el} imageTier={imageTier} />;
    case 'arrow': {
      const a = describeArrow(el, resolveTheme(presentation.theme, slide.theme));
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <ArrowGlyph geo={a.geo} color={a.color} strokeWidth={a.strokeWidth} opacity={a.opacity} />
        </svg>
      );
    }
    case 'demo':
    case 'demo-piece':
    case 'notebook':
      return <ThumbPreview element={el} />;
    case 'html': {
      // Static + locked (no script/network) → render the real thing for a true
      // mini-preview; it scales with the thumbnail's CSS transform.
      const p = el.position;
      if (htmlIsScaled(el)) {
        const L = htmlScaleLayout(p.width, p.height, el.scaleW!, el.scaleH!);
        return (
          <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden' }}>
            <iframe title="HTML element" srcDoc={htmlElementSrcdoc(el.html, el.background)}
              sandbox={HTML_SANDBOX_LOCKED} scrolling="no" style={{
                position: 'absolute', left: 0, top: 0, width: L.designW, height: L.designH,
                border: 'none', background: 'transparent', pointerEvents: 'none',
                transform: `translate(${L.offsetX}px, ${L.offsetY}px) scale(${L.scale})`,
                transformOrigin: 'top left',
              }} />
          </div>
        );
      }
      return (
        <iframe title="HTML element" srcDoc={htmlElementSrcdoc(el.html, el.background)}
          sandbox={HTML_SANDBOX_LOCKED} scrolling="no" style={{
            position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
            border: 'none', background: 'transparent', pointerEvents: 'none',
          }} />
      );
    }
    case 'video':
      return <ThumbVideo element={el} />;
    case 'cover': {
      // Match the slide background (it's a reveal mask) — no border, so the
      // static render matches the live slide / speaker view. Explicit color wins.
      const tt = resolveTheme(presentation.theme, slide.theme);
      const d = describeCover(el, tt.background, tt);
      return <CoverView box={d.box} background={d.background} />;
    }
    default:
      return null;
  }
}

function ThumbImage({ element, imageTier }: { element: Extract<SlideElement, { type: 'image' }>; imageTier: number }) {
  const p = element.position;
  const kind = element.kind ?? 'raster';
  const url = useRenderedAsset(element.assetId, kind, imageTier, imageTier, element.snapshotVariant);
  useAssetFileWatcher(element.assetId, element.id);
  return (
    <div style={{
      position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden',
      background: url ? 'transparent' : '#f0f0f0', border: url ? 'none' : '1px solid #ddd', borderRadius: 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', ...imageVisualStyle(element) }} />
        : <span style={{ fontSize: 24, color: '#aaa' }}>IMG</span>}
    </div>
  );
}

// demo / demo-piece / notebook all render as a cached-preview image with a
// typed placeholder fallback in an identical positioned box. The placeholder
// identity comes from ELEMENT_PLACEHOLDERS; notebook fills big with no border,
// demo/demo-piece are smaller dashed boxes; demo-piece shows the piece name.
function ThumbPreview({ element }: { element: Extract<SlideElement, { type: 'demo' | 'demo-piece' | 'notebook' }> }) {
  const p = element.position;
  useAssetFileWatcher(element.assetId, element.id);
  const spec = PH[element.type];
  const isNb = element.type === 'notebook';
  const fontSize = isNb ? 64 : element.type === 'demo' ? 20 : 16;
  const label = element.type === 'demo-piece' ? element.piece : spec.label;
  // Demos capture TRANSPARENT now (#111): keep the wrapper transparent so the
  // slide background (from the thumb-render div) and any elements beneath the demo
  // show through, matching the live slide. (Notebooks keep their white card.)
  return (
    <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height, overflow: 'hidden', background: isNb ? '#fff' : 'transparent' }}>
      <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, color: spec.color, background: spec.bg, ...(isNb ? {} : { border: `1px dashed ${spec.borderColor}` }) }}>{label}</div>
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
