// Canonical "render a slide as presented" — the SINGLE source of truth shared
// by both the single-window PresentMode AND the secondary-monitor presenter
// window (src/presenter.tsx). Everything here is PROP-DRIVEN (no store reads)
// so it works identically in the main window (store-backed) and the presenter
// window (fed by Tauri events into local state). This is what kills the old
// duplicate renderer drift (demos/notebooks breaking only on the projector).

import { useRef } from 'react';
import { resolveTheme } from '../lib/themes';
import { useDemoUrl } from '../lib/demoAssets';
import { useImageSrc } from '../lib/imageSrc';
import { usePlaybackRate, usePingPong, useEmbedSpeed, togglePlay } from '../lib/videoPlayback';
import { buildEmbedSrc, DEMO_SANDBOX, VIDEO_EMBED_ALLOW } from '../lib/videoEmbed';
import type { Presentation, Slide, SlideElement, TextElement } from '../types/presentation';
import { TextElementSvg } from './TextElementSvg';
import { NotebookContent } from './notebook/NotebookContent';
import { useDemoThemeInjection } from '../lib/demoThemeInject';
import { ArrowGlyph } from './ArrowGlyph';
import { imageVisualStyle } from '../lib/imageVisualStyle';
import { CoverView } from './ElementView';
import { describeCover, describeArrow } from '../lib/elementDescriptor.mjs';

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
      return <PresentDemoIframe assetId={el.assetId} pos={pos} zIndex={zIndex} style={style} ctx={ctx} />;
    case 'demo-piece':
      return <PresentDemoIframe assetId={el.assetId} hash={`piece=${el.piece}`} title={`demo-piece: ${el.piece}`} pos={pos} zIndex={zIndex} style={style} ctx={ctx} />;
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
    case 'cover': {
      // Reveal mask filled with the slide background (explicit color wins).
      const d = describeCover(el, resolveTheme(ctx.presentationTheme, ctx.slide.theme).background);
      return <CoverView box={d.box} background={d.background} extraStyle={{ zIndex, ...style }} />;
    }
    case 'arrow': {
      const a = describeArrow(el);
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex, ...style }}>
          <ArrowGlyph geo={a.geo} color={a.color} strokeWidth={a.strokeWidth} opacity={a.opacity} />
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
  if (!src) return null;
  return (
    <img src={src} alt="" style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, objectFit: 'contain', zIndex,
      ...imageVisualStyle(el),
      ...style,
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
    return <iframe key={embedSrc} ref={embedRef} src={embedSrc} title="video" allow={VIDEO_EMBED_ALLOW} style={{ ...box, border: 'none' }} />;
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

function PresentDemoIframe({ assetId, hash, title, pos, zIndex, style, ctx }: {
  assetId: string; hash?: string; title?: string;
  pos: { x: number; y: number; width: number; height: number }; zIndex: number;
  style?: React.CSSProperties; ctx?: PresentCtx;
}) {
  const src = useDemoUrl(assetId, hash);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Inject the deck's fonts + theme vars (#86) into the demo's contentDocument.
  useDemoThemeInjection(iframeRef, ctx?.presentationConfig as any, ctx?.presentationTheme || 'white', ctx?.slide, src);
  if (!src) return null;
  return (
    <iframe ref={iframeRef} src={src} sandbox={DEMO_SANDBOX} title={title || 'demo'} style={{
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
    <iframe src={src} sandbox={DEMO_SANDBOX} title={`controller: ${assetId.slice(0, 8)}`}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }} />
  );
}
