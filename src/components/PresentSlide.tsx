// Canonical "render a slide as presented" — the SINGLE source of truth shared
// by both the single-window PresentMode AND the secondary-monitor presenter
// window (src/presenter.tsx). Everything here is PROP-DRIVEN (no store reads)
// so it works identically in the main window (store-backed) and the presenter
// window (fed by Tauri events into local state). This is what kills the old
// duplicate renderer drift (demos/notebooks breaking only on the projector).

import { useRef, useState } from 'react';
import { useDemoUrl } from '../lib/demoAssets';
import { useImageSrc } from '../lib/imageSrc';
import { usePlaybackRate, usePingPong, useEmbedSpeed, togglePlay } from '../lib/videoPlayback';
import { buildEmbedSrc } from '../lib/videoEmbed';
import type { Presentation, Slide, SlideElement, TextElement } from '../types/presentation';
import { TextElementSvg } from './TextElementSvg';
import { NotebookContent } from './notebook/NotebookContent';

export interface PresentCtx {
  slide: Slide;
  presentationConfig: Presentation['config'];
  presentationTheme: string;
}

/** One presented element. Prop-driven so it renders the same in any window. */
export function PresentElement({ element: el, zIndex, style, ctx }: {
  element: SlideElement; zIndex: number; style?: React.CSSProperties; ctx: PresentCtx;
}) {
  const pos = el.position;
  switch (el.type) {
    case 'text':
      return <PresentTextElement element={el} zIndex={zIndex} style={style} ctx={ctx} />;
    case 'image':
      return <PresentImage element={el} zIndex={zIndex} style={style} />;
    case 'demo':
      return <PresentDemoIframe assetId={el.assetId} pos={pos} zIndex={zIndex} style={style} />;
    case 'demo-piece':
      return <PresentDemoIframe assetId={el.assetId} hash={`piece=${el.piece}`} title={`demo-piece: ${el.piece}`} pos={pos} zIndex={zIndex} style={style} />;
    case 'video':
      return <PresentVideo element={el} zIndex={zIndex} style={style} />;
    case 'notebook':
      return (
        <div className="el-notebook" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, zIndex, ...style,
        }}>
          <NotebookContent element={el} interactive={true} mode="present" />
        </div>
      );
    case 'cover':
      return (
        <div style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          background: el.color || '#ffffff', zIndex, ...style,
        }} />
      );
    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex, ...style }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
          <polygon points={`${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}`} fill={color} />
        </svg>
      );
    }
    default:
      return null;
  }
}

function PresentTextElement({ element: el, zIndex, style, ctx }: {
  element: TextElement; zIndex: number; style?: React.CSSProperties; ctx: PresentCtx;
}) {
  return (
    <TextElementSvg
      element={el} slide={ctx.slide}
      presentationTheme={ctx.presentationTheme}
      presentationConfig={ctx.presentationConfig}
      className={`el-text el-preset-${el.preset}`}
      zIndex={zIndex}
      styleOverride={style}
    />
  );
}

function PresentImage({ element: el, zIndex, style }: {
  element: Extract<SlideElement, { type: 'image' }>; zIndex: number; style?: React.CSSProperties;
}) {
  const pos = el.position;
  const src = useImageSrc(el.assetId, el.kind, {
    displayWidth: el.position.width, displayHeight: el.position.height, snapshotVariant: el.snapshotVariant,
  });
  // Image bytes resolve asynchronously (asset fetch / PDF render). Track decode
  // so we can FADE the image in rather than letting it pop to full opacity. A
  // late-loading image that pops appears "on top" of a still-fading title (the
  // opaque image shows through the not-yet-opaque text), then recedes once the
  // title finishes — the z-overlap-race glitch. Fading it removes the pop.
  const [loaded, setLoaded] = useState(false);
  if (!src) return null;
  // Opacity the element should settle at: the bucket's fade opacity if present,
  // else the element's own opacity, else 1. We ramp to it on decode.
  const settledOpacity = (style && 'opacity' in style ? style.opacity
    : (el.opacity != null && el.opacity < 1 ? el.opacity : 1));
  return (
    <img src={src} alt="" onLoad={() => setLoaded(true)} style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, objectFit: 'contain', zIndex,
      ...(el.shadow ? { filter: 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))' } : {}),
      ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
      ...(el.rotation ? { transform: `rotate(${el.rotation}deg)` } : {}),
      ...style,
      // Override opacity/transition AFTER the bucket style: fade in on decode,
      // composing with any bucket transition (so linked position anims survive).
      opacity: loaded ? settledOpacity : 0,
      transition: [style?.transition, 'opacity 250ms ease-in-out'].filter(Boolean).join(', '),
    }} />
  );
}

function PresentVideo({ element: el, zIndex, style }: {
  element: Extract<SlideElement, { type: 'video' }>; zIndex: number; style?: React.CSSProperties;
}) {
  const pos = el.position;
  const ref = useRef<HTMLVideoElement>(null);
  const embedRef = useRef<HTMLIFrameElement>(null);
  const src = useDemoUrl(el.assetId);
  const captionsSrc = useDemoUrl(el.captionsAssetId);
  const embedSrc = el.kind === 'embed' ? buildEmbedSrc(el) : null;
  usePlaybackRate(ref, el.playbackRate ?? 1, src);
  usePingPong(ref, !!el.pingPong, el.playbackRate ?? 1, src);
  useEmbedSpeed(embedRef, el.provider, el.playbackRate ?? 1, embedSrc);
  const box: React.CSSProperties = {
    position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, objectFit: 'contain', background: '#000', zIndex, ...style,
  };
  if (el.kind === 'embed') {
    if (!embedSrc) return null;
    return <iframe key={embedSrc} ref={embedRef} src={embedSrc} title="video" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" style={{ ...box, border: 'none' }} />;
  }
  if (!src) return null;
  return (
    <video ref={ref} src={src} playsInline loop={!!el.loop && !el.pingPong} muted={!!el.muted}
      autoPlay={!!el.autoplay} controls={!!el.controls}
      onClick={el.controls ? undefined : () => togglePlay(ref.current)}
      style={el.controls ? box : { ...box, cursor: 'pointer' }}>
      {el.captions && captionsSrc && (
        <track kind="captions" src={captionsSrc} srcLang="en" label={el.captionsLabel || 'Captions'} default />
      )}
    </video>
  );
}

function PresentDemoIframe({ assetId, hash, title, pos, zIndex, style }: {
  assetId: string; hash?: string; title?: string;
  pos: { x: number; y: number; width: number; height: number }; zIndex: number; style?: React.CSSProperties;
}) {
  const src = useDemoUrl(assetId, hash);
  if (!src) return null;
  return (
    <iframe src={src} sandbox="allow-scripts allow-same-origin" title={title || 'demo'} style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, border: 'none', zIndex, ...style,
    }} />
  );
}

/** Hidden BroadcastChannel controller for demo-piece elements (deduped by
 *  assetId). Without these, demo-pieces don't update — the bug that hit the
 *  old presenter window, which never rendered them. */
export function PresentControllerIframe({ assetId }: { assetId: string }) {
  const src = useDemoUrl(assetId, 'role=controller');
  if (!src) return null;
  return (
    <iframe src={src} sandbox="allow-scripts allow-same-origin" title={`controller: ${assetId.slice(0, 8)}`}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }} />
  );
}
