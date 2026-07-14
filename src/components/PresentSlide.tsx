// Canonical "render a slide as presented" — the SINGLE source of truth shared
// by both the single-window PresentMode AND the secondary-monitor presenter
// window (src/presenter.tsx). Everything here is PROP-DRIVEN (no store reads)
// so it works identically in the main window (store-backed) and the presenter
// window (fed by Tauri events into local state). This is what kills the old
// duplicate renderer drift (demos/notebooks breaking only on the projector).

import { useRef } from 'react';
import { resolveTheme } from '../lib/themes';
import { useAssetUrl } from '../lib/demoAssets';
import { useDemoDoc, useDeckFontFacesCss } from '../lib/demoMount';
import { htmlElementSrcdoc, HTML_SANDBOX_LOCKED, htmlIsScaled, htmlScaleLayout } from '../lib/htmlElement.mjs';
import { useImageSrc } from '../lib/imageSrc';
import { usePlaybackRate, usePingPong, useEmbedSpeed, togglePlay } from '../lib/videoPlayback';
import { VIDEO_EMBED_ALLOW } from '../lib/videoEmbed';
import { useYoutubeShimBase, liveEmbedSrc } from '../lib/youtubeShim';
import type { Presentation, Slide, SlideElement, TextElement } from '../types/presentation';
import { TextElementSvg } from './TextElementSvg';
import { NotebookContent } from './notebook/NotebookContent';
import { demoVarsCssForSlide } from '../lib/demoThemeInject';
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
      const t = resolveTheme(ctx.presentationTheme, ctx.slide.theme);
      const d = describeCover(el, t.background, t);
      return <CoverView box={d.box} background={d.background} extraStyle={{ zIndex, ...style }} />;
    }
    case 'arrow': {
      const a = describeArrow(el, resolveTheme(ctx.presentationTheme, ctx.slide.theme));
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex, ...style }}>
          <ArrowGlyph geo={a.geo} color={a.color} strokeWidth={a.strokeWidth} opacity={a.opacity} />
        </svg>
      );
    }
    case 'html': {
      // Locked (no-script, no-network, no same-origin). `interactive` elements
      // receive clicks so native controls (range/radio/details/:hover) work live;
      // static ones stay pass-through so they never block the slide.
      const htmlTheme = resolveTheme(ctx.presentationTheme, ctx.slide.theme);
      // Scale mode: content laid out at its design size, contain-scaled into the box.
      if (htmlIsScaled(el)) {
        const L = htmlScaleLayout(pos.width, pos.height, el.scaleW!, el.scaleH!);
        return (
          <div style={{
            position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
            overflow: 'hidden', zIndex, ...style,
          }}>
            <iframe title="HTML element" srcDoc={htmlElementSrcdoc(el.html, el.background, el.vars, htmlTheme)}
              sandbox={HTML_SANDBOX_LOCKED} style={{
                position: 'absolute', left: 0, top: 0, width: L.designW, height: L.designH,
                border: 'none', background: 'transparent',
                transform: `translate(${L.offsetX}px, ${L.offsetY}px) scale(${L.scale})`,
                transformOrigin: 'top left',
                pointerEvents: el.interactive ? 'auto' : 'none',
              }} />
          </div>
        );
      }
      return (
        <iframe title="HTML element" srcDoc={htmlElementSrcdoc(el.html, el.background, el.vars, htmlTheme)}
          sandbox={HTML_SANDBOX_LOCKED} style={{
            position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
            border: 'none', background: 'transparent',
            pointerEvents: el.interactive ? 'auto' : 'none', zIndex, ...style,
          }} />
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
  const iv = imageVisualStyle(el);
  // The transition wrapper `style` carries the fade opacity; if spread last it would
  // clobber the element's authored opacity. Combine them (fade × element opacity) so
  // both survive — matching editor/export where the element opacity always applies.
  const elOpacity = typeof iv.opacity === 'number' ? iv.opacity : 1;
  const fadeOpacity = typeof style?.opacity === 'number' ? style.opacity : 1;
  return (
    <img src={src} alt="" style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, objectFit: 'contain', zIndex,
      ...iv,
      ...style,
      opacity: elOpacity * fadeOpacity,
    }} />
  );
}

function PresentVideo({ element: el, zIndex, style }: {
  element: Extract<SlideElement, { type: 'video' }>; zIndex: number; style?: React.CSSProperties;
}) {
  const pos = el.position;
  const ref = useRef<HTMLVideoElement>(null);
  const embedRef = useRef<HTMLIFrameElement>(null);
  const src = useAssetUrl(el.assetId);                 // video FILE — a plain asset,
  const captionsSrc = useAssetUrl(el.captionsAssetId); // not a demo (no demo-marker gate)
  const shimBase = useYoutubeShimBase();
  const embedSrc = el.kind === 'embed' ? liveEmbedSrc(el, shimBase) : null;
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
  // Opaque-origin mount (docs/DEMO-PLATFORM.md): theme vars + data-URL fonts
  // spliced at build; comm over the parent relay.
  const fontFacesCss = useDeckFontFacesCss();
  const varsCss = ctx?.slide
    ? demoVarsCssForSlide(ctx.presentationConfig as any, ctx.presentationTheme || 'white', ctx.slide)
    : '';
  const src = useDemoDoc(assetId, {
    hash: hash || '',
    channelKey: assetId,
    varsCss,
    fontFacesCss,
  });
  if (!src) return null;
  return (
    <iframe src={src} sandbox="allow-scripts" className="el-demo-frame" title={title || 'demo'} style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height, border: 'none', zIndex, ...style,
    }} />
  );
}

/** Hidden BroadcastChannel controller for demo-piece elements (deduped by
 *  assetId). Without these, demo-pieces don't update — the bug that hit the
 *  old presenter window, which never rendered them. */
export function PresentControllerIframe({ assetId }: { assetId: string }) {
  const fontFacesCss = useDeckFontFacesCss();
  const src = useDemoDoc(assetId, { hash: 'role=controller', channelKey: assetId, fontFacesCss });
  if (!src) return null;
  return (
    <iframe src={src} sandbox="allow-scripts" className="el-demo-frame" title={`controller: ${assetId.slice(0, 8)}`}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }} />
  );
}
