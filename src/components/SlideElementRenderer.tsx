import { useRef, useState, useCallback, useEffect } from 'react';
import { useContextTarget, setContextTarget } from '../lib/contextTarget';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore, pauseUndo, resumeUndo } from '../store/presentation';
import { getPreference } from '../lib/preferences';
import { snapToGrid, resizeEdgeToGrid } from '../lib/grid';
import { arrowBBox } from '../lib/arrowGeometry.mjs';
import { ArrowGlyph } from './ArrowGlyph';
import { imageVisualStyle } from '../lib/imageVisualStyle';
import { describeCover, describeArrow } from '../lib/elementDescriptor.mjs';
import { htmlElementSrcdoc, HTML_SANDBOX_EDITABLE, htmlIsScaled, htmlScaleLayout } from '../lib/htmlElement.mjs';
import { sanitizeRichText } from '../lib/sanitizeRichText';
import { useAssetUrl } from '../lib/demoAssets';
import { demoVarsCssForSlide } from '../lib/demoThemeInject';
import { useDemoDoc, useDeckFontFacesCss } from '../lib/demoMount';
import { capturePreview } from '../lib/previewCache';
import { usePlaybackRate, usePingPong, useEmbedSpeed, togglePlay } from '../lib/videoPlayback';
import { buildEmbedSrc, VIDEO_EMBED_ALLOW } from '../lib/videoEmbed';
import { NotebookBox } from './NotebookBox';
import { useImageSrc } from '../lib/imageSrc';
import { EIGENDECK_PASTE_MARKER, hasEigendeckMarker, stripEigendeckMarker } from '../lib/clipboard';
import { resolveTheme, themeColorForPreset } from '../lib/themes';
import type { ThemeColors } from '../lib/themes';

import { TEXT_PRESET_STYLES, effectiveFontSize, textBackgroundResolved, textShadowCss, textBoxShadowCss, textPresetBoxCss, textPaddingCss, resolveColor } from '../types/presentation';
import { fontForPreset, fontFamilyForPreset, resolveMonoFontPackage } from '../lib/fonts';
import { buildTextElementSvgMarkup } from './TextElementSvg';
import { TextFormatToolbar } from './TextFormatToolbar';
import { getDisplayMathHeight } from '../lib/mathjax';
import {
  renderMathInHtml as renderMathInIframe,
  containsMath as containsMathExpr,
} from '../lib/mathjaxRenderer';
import type { SlideElement, ElementPosition, TextElement } from '../types/presentation';

interface Props {
  element: SlideElement;
  zIndex: number;
  scale: number;
  projectPath: string | null;
  isSelected: boolean;
  /** Resolved slide background — a cover with no explicit color matches it. */
  slideBackground?: string;
  /** Resolved slide theme — a themed Card fill (boxTint) resolves against it. */
  theme?: ThemeColors;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void;
  onSelect: (e?: { shiftKey: boolean }) => void;
}


/**
 * Controls shown while you're *interacting* with an embedded element (demo,
 * notebook, video) — i.e. after a double-click. Rendered centered ABOVE the
 * element (in the tag/badge area) rather than inside the content, so it doesn't
 * cover the demo. Counter-scaled to stay a fixed on-screen size at any zoom.
 * Always carries a "Lock" button (re-locks so the element can be dragged);
 * `children` adds element-specific controls (e.g. a video Play/Pause).
 */
export function InteractLockBar({ scale, onLock, children }: {
  scale: number; onLock: () => void; children?: React.ReactNode;
}) {
  const btn: React.CSSProperties = {
    padding: '2px 10px', fontSize: 11, border: '1px solid #cbd0d8', borderRadius: 4,
    background: 'rgba(255,255,255,0.96)', cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
  };
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: '50%', zIndex: 3,
      display: 'flex', gap: 4, marginBottom: 6,
      transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: 'bottom center',
    }}>
      {children}
      <button className="demo-lock-btn" onClick={onLock} style={btn} title="Lock (allow dragging again)">🔒 Lock</button>
    </div>
  );
}

export function SlideElementRenderer({
  element, zIndex, scale, projectPath, isSelected, slideBackground, theme, onUpdate, onDelete, onSelect,
}: Props) {
  switch (element.type) {
    case 'text':
      return (
        <DraggableBox
          element={element} zIndex={zIndex} scale={scale}
          className={`el-text el-preset-${element.preset}`}
          isSelected={isSelected}
          boxStyle={{ backgroundColor: textBackgroundResolved(element, theme), boxShadow: textBoxShadowCss(element), borderRadius: element.borderRadius || undefined }}
          rotation={element.rotation}
          dataValign={element.verticalAlign || (element.preset === 'title' || element.preset === 'footnote' ? 'bottom' : undefined)}
          onEdit={() => {
            // Trigger edit mode on the TextContent inside this box
            const el = document.querySelector(`[data-element-id="${element.id}"]`);
            if (el) el.dispatchEvent(new CustomEvent('start-editing', { bubbles: false }));
          }}
          onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
        >
          <TextContent element={element} onCommit={(html) => onUpdate({ html } as any)} />
        </DraggableBox>
      );

    case 'image':
      return (
        <ImageBox element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected} onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate} />
      );

    case 'demo':
      return (
        <DemoBox
          element={element} zIndex={zIndex} scale={scale}
          projectPath={projectPath} isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'demo-piece':
      return (
        <DemoBox
          element={element} zIndex={zIndex} scale={scale}
          projectPath={projectPath} isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'notebook':
      return (
        <NotebookBox
          element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'video':
      return (
        <VideoBox
          element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'cover':
      return (
        <DraggableBox
          element={element} zIndex={zIndex} scale={scale}
          className="el-cover" isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
        >
          <div style={{
            width: '100%', height: '100%',
            // Match the slide background (a cover is a reveal mask). The .el-cover
            // CSS draws a dashed outline so it stays visible/selectable in the
            // editor even when the fill matches the background. The editor
            // specializes the WRAPPER (DraggableBox); the fill value comes from
            // the shared cover descriptor.
            background: describeCover(element, slideBackground || '#ffffff', theme).background,
            pointerEvents: 'none',
          }} />
        </DraggableBox>
      );

    case 'arrow':
      return (
        <ArrowRenderer element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected} theme={theme}
          onUpdate={onUpdate} onDelete={onDelete} onSelect={onSelect} />
      );

    case 'html':
      return (
        <HtmlBox
          element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
        />
      );
  }
}

// ============================================
// Image element — loads from SQLite blob URL
// ============================================
// Module-level cache so the placeholder label doesn't refetch per
// remount or per duplicate ImageBox. Path won't change for the life
// of an assetId (db_store_asset creates a new asset_id for new bytes).
const assetPathCache = new Map<string, string | null>();
const assetPathInflight = new Map<string, Promise<string | null>>();

function useAssetPath(assetId: string): string | null {
  const [path, setPath] = useState<string | null>(() => assetPathCache.get(assetId) ?? null);
  useEffect(() => {
    if (assetPathCache.has(assetId)) {
      setPath(assetPathCache.get(assetId) ?? null);
      return;
    }
    let cancelled = false;
    let p = assetPathInflight.get(assetId);
    if (!p) {
      p = invoke<{ path?: string | null } | null>('db_get_asset_meta_by_id', { assetId })
        .then((m) => {
          const v = m?.path ?? null;
          assetPathCache.set(assetId, v);
          return v;
        })
        .catch(() => null)
        .finally(() => { assetPathInflight.delete(assetId); });
      assetPathInflight.set(assetId, p);
    }
    p.then((v) => { if (!cancelled) setPath(v); });
    return () => { cancelled = true; };
  }, [assetId]);
  return path;
}

/** Delay before showing the placeholder. Most cached renders resolve
 *  in <50ms; the brief flash of placeholder is more annoying than a
 *  blank gap. 500ms is the inflection — fast renders never show the
 *  placeholder; slow ones (cache misses, big PDFs) do. */
const PLACEHOLDER_DELAY_MS = 500;

function ImageBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'image' }>;
  zIndex: number; scale: number;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const src = useImageSrc(element.assetId, element.kind, {
    displayWidth: element.position.width,
    displayHeight: element.position.height,
    snapshotVariant: element.snapshotVariant,
  });
  const assetPath = useAssetPath(element.assetId);

  // Delay showing the placeholder so cache-hit renders (the common
  // case) don't flash a blue tile for 1 frame before the real image
  // resolves. Timer is cleared if src arrives within the threshold.
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  useEffect(() => {
    if (src) { setShowPlaceholder(false); return; }
    const t = setTimeout(() => setShowPlaceholder(true), PLACEHOLDER_DELAY_MS);
    return () => clearTimeout(t);
  }, [src]);

  const kindLabel = element.kind === 'pdf' ? 'PDF'
    : element.kind === 'svg' ? 'SVG'
    : 'IMG';
  const filename = assetPath ? (assetPath.split('/').pop() || assetPath) : null;

  return (
    <DraggableBox
      element={element} zIndex={zIndex} scale={scale}
      className="el-image" isSelected={isSelected}
      onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
    >
      {src ? (
        <img src={src} alt="" draggable={false}
          style={{
            width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none',
            ...imageVisualStyle(element),
          }} />
      ) : showPlaceholder ? (
        // Placeholder while the asset rasterizes. Matches the blue
        // DEMO tile in the sidebar for visual consistency. Labels by
        // kind + filename so the user can tell which file is grinding
        // through pdfium during a multi-asset cache build.
        <div style={{
          width: '100%', height: '100%',
          background: '#e8f4f8', border: '1px dashed #93c5fd', borderRadius: 2,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '8px 12px',
          color: '#60a5fa', pointerEvents: 'none', userSelect: 'none',
          textAlign: 'center', overflow: 'hidden',
        }}>
          {/* Font sizes divided by `scale` so they render at a fixed
              pixel size on screen regardless of the editor's zoom
              level. The slide canvas is transform: scale(scale), which
              shrinks everything inside it; pre-scaling-up text by
              1/scale produces a constant on-screen size. Same trick
              should be applied to the X/L action chips on element
              hover — they shrink with zoom for the same reason. */}
          <div style={{ fontSize: 28 / scale, fontWeight: 700, lineHeight: 1.0 }}>{kindLabel}</div>
          {filename && (
            <div style={{
              marginTop: 8 / scale, fontSize: 14 / scale, fontWeight: 500,
              maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{filename}</div>
          )}
          <div style={{ marginTop: 4 / scale, fontSize: 12 / scale, fontStyle: 'italic', opacity: 0.8 }}>
            rendering…
          </div>
        </div>
      ) : null}
    </DraggableBox>
  );
}

// ============================================
// Demo / demo-piece element — same interactive iframe box; a demo-piece just
// adds the `piece=` viewport hash (and a piece-specific class/title/fallback).
// ============================================
function DemoBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'demo' | 'demo-piece' }>;
  zIndex: number; scale: number; projectPath?: string | null;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const piece = element.type === 'demo-piece' ? element.piece : undefined;
  const [interacting, setInteracting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Reload the iframe when this demo's asset changes (the inspector's "Reload
  // from disk now" / file-watch fires eigendeck:asset-changed). Replaces the
  // old in-overlay Refresh button.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent).detail?.assetId === element.assetId) setReloadKey((k) => k + 1);
    };
    window.addEventListener('eigendeck:asset-changed', onChanged as EventListener);
    return () => window.removeEventListener('eigendeck:asset-changed', onChanged as EventListener);
  }, [element.assetId]);
  const demoConfig = usePresentationStore((s) => s.presentation.config);
  const demoTheme = usePresentationStore((s) => s.presentation.theme);
  const demoSlide = usePresentationStore((s) => s.presentation.slides[s.currentSlideIndex]);
  // Proactively cache a PNG preview of the rendered demo (sidebar thumbs /
  // export) once it's loaded + settled. The demo is OPAQUE-origin, so capturePreview
  // can't read its contentDocument — it asks the in-demo bridge to rasterize itself
  // (docs/DEMO-PLATFORM.md §8). Debounced; re-runs on reload/resize AND on theme/font
  // change — the theme is spliced as CSS vars at mount, not in the captured content,
  // so it's passed as the cache salt so a theme switch busts the preview (#86).
  const themeSalt = demoSlide ? demoVarsCssForSlide(demoConfig, demoTheme, demoSlide) : '';
  // Opaque-origin mount (docs/DEMO-PLATFORM.md): theme vars + data-URL fonts are
  // spliced into the built document, and comm goes over the parent relay. No more
  // contentDocument writes (the sandbox drops allow-same-origin below).
  const fontFacesCss = useDeckFontFacesCss();
  const src = useDemoDoc(element.assetId, {
    hash: piece ? `piece=${piece}` : '',
    channelKey: element.assetId || 'demo',
    varsCss: themeSalt,
    fontFacesCss,
    capture: true, // editor: inline the capture handler for thumbnails
  });
  // Capture the preview TRANSPARENT (no baked backdrop). A demo iframe is
  // transparent so the slide — and any elements beneath the demo — must show
  // through in the static renders too; the render context supplies the slide
  // background behind the preview (see SlideThumbnail / the export slide bg).
  // Baking the bg here made the preview opaque and covered overlapping lower
  // elements (#111).
  useEffect(() => {
    if (!src) return;
    const t = setTimeout(() => { void capturePreview(element, 'iframe', themeSalt); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, reloadKey, element.position.width, element.position.height, element.id, element.syncId, themeSalt]);
  return (
    <DraggableBox
      element={element} zIndex={zIndex} scale={scale}
      className={piece ? 'el-demo el-demo-piece' : 'el-demo'} isSelected={isSelected}
      onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
    >
      {src ? (
        <iframe key={reloadKey} src={src} sandbox="allow-scripts" className="el-demo-frame" title={piece ? `demo-piece: ${piece}` : 'demo'}
          style={{ width: '100%', height: '100%', border: 'none', pointerEvents: interacting ? 'auto' : 'none' }} />
      ) : src === null ? (
        // Blocked by the demo-mount gate: bytes aren't a marked eigendeck demo.
        <div style={{ padding: 20, color: '#b91c1c', fontSize: 12, lineHeight: 1.4 }}>
          This isn’t a valid Eigendeck demo, so it isn’t shown.{piece ? ` (piece #${piece})` : ''}
        </div>
      ) : <div style={{ padding: 20, color: '#999' }}>{piece ? `Demo piece: #${piece}` : 'Demo'}</div>}
      {!interacting && (
        <div className="demo-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        // Reload moved to the inspector's Asset section ("Reload from disk now").
        <InteractLockBar scale={scale} onLock={() => setInteracting(false)} />
      )}
    </DraggableBox>
  );
}

// ============================================
// HTML element (#137) — raw HTML in a locked, script-less sandboxed iframe (an
// injected CSP blocks all network). Double-click to edit inline: because the
// editor's sandbox is `allow-same-origin` WITHOUT allow-scripts (no page JS can
// run — the safe combination), the parent can toggle contentEditable on the
// framed document and read the markup back. Best-effort — arbitrary HTML may not
// edit cleanly, so a warning shows and the Inspector's textarea is the reliable
// source of truth.
// ============================================
function HtmlBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'html' }>;
  zIndex: number; scale: number;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [editing, setEditing] = useState(false);      // contentEditable (static HTML)
  const [interacting, setInteracting] = useState(false); // clickable controls (interactive HTML)
  const interactive = !!element.interactive;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = htmlElementSrcdoc(element.html, element.background);

  // Read the edited markup back out of the frame and leave edit mode. Kept in a
  // ref so the keydown/blur listeners always call the latest version.
  const finishRef = useRef<() => void>(() => {});
  finishRef.current = () => {
    const html = iframeRef.current?.contentDocument?.body?.innerHTML;
    if (html != null && html !== element.html) onUpdate({ html } as any);
    setEditing(false);
  };

  // Enter edit mode: make the framed body contentEditable + focus it.
  useEffect(() => {
    if (!editing) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) { setEditing(false); return; }
    doc.body.contentEditable = 'true';
    doc.body.style.outline = 'none';
    doc.body.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finishRef.current(); } };
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('keydown', onKey);
      try { doc.body.contentEditable = 'false'; } catch { /* frame reloaded/gone */ }
    };
  }, [editing]);

  // Double-click: interactive elements enter "interact" mode (click native
  // controls, like a demo); static ones enter contentEditable edit mode.
  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (interactive) setInteracting(true); else setEditing(true);
  };
  const live = editing || interacting;

  // Exit like text editing — NO "Lock". Click outside the element (or press
  // Escape) finishes: commit for editing, stop for interacting. Clicks INSIDE the
  // iframe are captured by the frame (no parent pointerdown reaches here), so
  // interacting with the content never exits.
  useEffect(() => {
    if (!live) return;
    const finish = () => { if (editing) finishRef.current(); else setInteracting(false); };
    const onDown = (e: PointerEvent) => {
      const host = iframeRef.current?.closest('[data-element-id]');
      if (host && e.target instanceof Node && !host.contains(e.target)) finish();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [live, editing]);

  return (
    <DraggableBox
      element={element} zIndex={zIndex} scale={scale}
      className="el-html" isSelected={isSelected}
      onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
    >
      {htmlIsScaled(element) ? (() => {
        // Scale mode: design-size iframe contain-scaled into the box (clipped).
        // Editing/interacting still work through the transformed frame; the raw
        // source stays 1:1 in the Inspector.
        const L = htmlScaleLayout(element.position.width, element.position.height, element.scaleW!, element.scaleH!);
        return (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <iframe ref={iframeRef} title="HTML element" srcDoc={srcDoc} sandbox={HTML_SANDBOX_EDITABLE}
              style={{ position: 'absolute', left: 0, top: 0, width: L.designW, height: L.designH,
                border: 'none', background: 'transparent',
                transform: `translate(${L.offsetX}px, ${L.offsetY}px) scale(${L.scale})`, transformOrigin: 'top left',
                pointerEvents: live ? 'auto' : 'none' }} />
          </div>
        );
      })() : (
        <iframe ref={iframeRef} title="HTML element" srcDoc={srcDoc} sandbox={HTML_SANDBOX_EDITABLE}
          style={{ width: '100%', height: '100%', border: 'none', background: 'transparent',
            pointerEvents: live ? 'auto' : 'none' }} />
      )}
      {!live && (
        <div className="demo-overlay"
          onDoubleClick={onDoubleClick}
          style={{ position: 'absolute', inset: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {live && (
        // A status hint BELOW the element (no "Lock" button — click away / Esc to
        // finish, like text editing). Amber warning while editing; subtle while
        // interacting. Inverse-scaled to stay readable; never blocks input.
        <div style={{
          position: 'absolute', top: '100%', left: '50%', zIndex: 3, marginTop: 6,
          transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: 'top center',
          padding: '3px 10px', fontSize: 11, borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none',
          ...(editing
            ? { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }
            : { background: '#e0f2fe', color: '#075985', border: '1px solid #7dd3fc' }),
        }}>
          {editing
            ? '⚠ direct edits may reshape complex HTML — click away or Esc to finish · raw source is in the Inspector'
            : 'interacting — click away or Esc to finish'}
        </div>
      )}
    </DraggableBox>
  );
}

// ============================================
// Video element — local file (<video>) in the editor. Double-click the overlay
// to interact (play/pause, or native controls if enabled); Lock to drag again.
// ============================================
function VideoBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'video' }>;
  zIndex: number; scale: number;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = useAssetUrl(element.assetId);                  // file kind — a plain
  const captionsSrc = useAssetUrl(element.captionsAssetId);  // asset, NOT a demo (no
  // demo-marker gate: videos/captions aren't demos, so they use useAssetUrl, not the
  // demo-mount path in demoMount.ts — which blocks non-marked HTML, #196).
  // In the EDITOR, never autoplay an embed while you're designing — it's
  // distracting and noisy. Build the src with autoplay suppressed until you
  // double-click to interact (files already don't autoplay in the editor —
  // the <video> has no autoPlay attr). Present mode keeps real autoplay.
  const embedSrc = element.kind === 'embed'
    ? buildEmbedSrc(interacting ? element : { ...element, autoplay: false })
    : null;
  const embedRef = useRef<HTMLIFrameElement>(null);
  usePlaybackRate(videoRef, element.playbackRate ?? 1, src);
  usePingPong(videoRef, !!element.pingPong, element.playbackRate ?? 1, src);
  useEmbedSpeed(embedRef, element.provider, element.playbackRate ?? 1, embedSrc);
  const btn: React.CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, background: 'rgba(255,255,255,0.9)', cursor: 'pointer' };
  return (
    <DraggableBox
      element={element} zIndex={zIndex} scale={scale}
      className="el-video" isSelected={isSelected}
      onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate}
    >
      {element.kind === 'embed' ? (
        embedSrc
          ? <iframe key={embedSrc} ref={embedRef} src={embedSrc} title="video" allow={VIDEO_EMBED_ALLOW}
              style={{ width: '100%', height: '100%', border: 'none', background: '#000',
                pointerEvents: interacting ? 'auto' : 'none' }} />
          : <div style={{ padding: 20, color: '#999' }}>Unrecognized video URL</div>
      ) : src ? (
        <video ref={videoRef} src={src} playsInline
          loop={!!element.loop && !element.pingPong}
          muted={!!element.muted}
          controls={!!element.controls && interacting}
          // While interacting with a chrome-free video, click it to play/pause.
          onClick={interacting && !element.controls ? () => togglePlay(videoRef.current) : undefined}
          // A poster frame for the sidebar/export preview, once a frame decodes.
          onLoadedData={() => { void capturePreview(element, 'video'); }}
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000',
            cursor: interacting && !element.controls ? 'pointer' : undefined,
            pointerEvents: interacting ? 'auto' : 'none' }}>
          {element.captions && captionsSrc && (
            <track kind="captions" src={captionsSrc} srcLang="en"
              label={element.captionsLabel || 'Captions'} default />
          )}
        </video>
      ) : <div style={{ padding: 20, color: '#999' }}>Video</div>}
      {!interacting && (
        <div className="demo-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <InteractLockBar scale={scale} onLock={() => { videoRef.current?.pause(); setInteracting(false); }}>
          {element.kind === 'file' && !element.controls && (
            <button className="demo-lock-btn" style={btn} onClick={() => {
              const v = videoRef.current; if (!v) return;
              if (v.paused) void v.play().catch(() => {}); else v.pause();
            }}>▶ / ❚❚</button>
          )}
        </InteractLockBar>
      )}
    </DraggableBox>
  );
}

// ============================================
// Text content — display via <svg><foreignObject>, edit via contentEditable HTML.
// The SVG/foreignObject path lets math render with the element's preset-matched
// font (via the per-bundle iframe pool in mathjaxRenderer.ts) — multiple math
// fonts can coexist on the same slide, which the singleton-MathJax approach in
// src/lib/mathjax.ts can't deliver.
// ============================================


function TextContent({
  element,
  onCommit,
}: {
  element: TextElement;
  onCommit: (html: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Survives unmount: React nulls `ref.current` before passive-effect cleanups run,
  // so the commit-on-unmount (below) can't read `ref`. This callback ref keeps the
  // last live node (never cleared on the null callback), and a detached node's
  // innerHTML is still readable — so we can commit the in-progress edit on unmount.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setEditRef = useCallback((n: HTMLDivElement | null) => { ref.current = n; if (n) nodeRef.current = n; }, []);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0, width: 0 });

  const presetStyle = TEXT_PRESET_STYLES[element.preset];
  // Resolve theme color: explicit element.color > theme color > preset default
  const { presentation, currentSlideIndex } = usePresentationStore.getState();
  const slide = presentation.slides[currentSlideIndex];
  const themeColors = resolveTheme(presentation.theme, slide?.theme);
  const themeColor = themeColorForPreset(themeColors, element.preset);
  // Resolve font: slide override > presentation default > 'ptsans'.
  // Title preset uses titleFont, hype preset uses hypeFont, others use bodyFont.
  const presetFontPkg = fontForPreset(element.preset, slide || {}, presentation.config);
  const presetFontFamily = fontFamilyForPreset(presetFontPkg, element.preset);

  const fontFamily = element.fontFamily || presetFontFamily;
  const fontSize = effectiveFontSize(element, presentation.config);
  const fontWeight = presetStyle.fontWeight;
  const fontStyle = presetStyle.fontStyle;
  const color = resolveColor(element.color, themeColors, themeColor);
  // Math bundle = THIS preset's font bundle. Title elements use title math,
  // hype elements use hype math, others use body math. Each iframe pool stays
  // loaded so switching slides is fast.
  const mathBundleId = presetFontPkg.id;

  const valign = element.verticalAlign || (element.preset === 'title' || element.preset === 'footnote' ? 'bottom' : undefined);

  const boxCss = textPresetBoxCss(element.preset);
  const style: React.CSSProperties = {
    width: '100%',
    fontFamily, fontSize, fontWeight, fontStyle, color,
    lineHeight: boxCss.lineHeight,
    padding: textPaddingCss(element, element.preset),
    outline: 'none',
    overflow: 'hidden',
    textShadow: textShadowCss(element, color),
    cursor: editing ? 'text' : 'inherit',
  };

  // Display: pre-render math (via iframe pool) into a string we splice into
  // the foreignObject's HTML. Falls back to raw element.html while pending.
  const mathPreamble = presentation.config.mathPreamble || '';
  const [renderedHtml, setRenderedHtml] = useState<string>(element.html || '');
  useEffect(() => {
    let cancelled = false;
    if (editing) return;
    if (!containsMathExpr(element.html)) {
      setRenderedHtml(element.html || '');
      return () => { cancelled = true; };
    }
    renderMathInIframe(element.html, mathBundleId, mathPreamble).then((html) => {
      if (!cancelled) setRenderedHtml(html);
    }).catch((err) => {
      console.warn('TextContent math render failed:', err);
      if (!cancelled) setRenderedHtml(element.html || '');
    });
    return () => { cancelled = true; };
  }, [element.html, mathBundleId, editing, mathPreamble]);

  // Listen for 'start-editing' custom event from context menu
  useEffect(() => {
    const el = wrapperRef.current?.closest('[data-element-id]');
    if (!el) return;
    const handler = () => { if (!editing) startEditing(); };
    el.addEventListener('start-editing', handler);
    return () => el.removeEventListener('start-editing', handler);
  });

  // Position toolbar
  useEffect(() => {
    if (editing && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setToolbarPos({ top: rect.top - 46, left: rect.left, width: rect.width });
    }
  }, [editing]);

  // $$ line height helpers — reserve space for display math during editing
  // so text layout matches the rendered output (WYSIWYG)
  const extractDisplayTex = (text: string): string | null => {
    const match = text.trim().match(/^\$\$([\s\S]*?)\$\$/);
    return match ? match[1] : null;
  };

  const applyMathLineStyles = (el: HTMLElement) => {
    // Only apply to direct child ELEMENTS (each <div> line in contentEditable)
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const node = child as HTMLElement;
      // Check if THIS node's own text (not descendants) starts with $$
      // Use firstChild textContent to avoid picking up text from siblings
      const ownText = node.textContent || '';
      if (ownText.trimStart().startsWith('$$') && ownText.includes('$$', 2)) {
        const tex = extractDisplayTex(ownText);
        if (tex) {
          const cachedHeight = getDisplayMathHeight(tex);
          if (cachedHeight) {
            node.style.minHeight = cachedHeight;
            node.style.lineHeight = 'normal';
          }
        }
      } else {
        // Clear only the styles WE set
        if (node.style.minHeight) node.style.minHeight = '';
        if (node.style.lineHeight === 'normal') node.style.lineHeight = '';
      }
    }
  };

  const stripMathLineStyles = (el: HTMLElement) => {
    for (const child of Array.from(el.querySelectorAll('*'))) {
      const c = child as HTMLElement;
      if (c.style.minHeight) c.style.minHeight = '';
      if (c.style.lineHeight === 'normal') c.style.lineHeight = '';
    }
  };

  const startEditing = () => {
    setEditing(true);
    setTimeout(() => {
      if (ref.current) {
        ref.current.innerHTML = element.html;
        applyMathLineStyles(ref.current);
        ref.current.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(ref.current);
          sel.collapseToEnd();
        }
      }
    }, 0);
  };

  // Read the contentEditable, normalize/sanitize it, and commit to the store —
  // WITHOUT touching editing state, so it's safe to call from an unmount cleanup.
  const commitHtml = useCallback(() => {
    // On unmount ref.current is already null; fall back to the surviving node ref.
    const node = ref.current || nodeRef.current;
    if (!node) return;
    stripMathLineStyles(node);
    // Sanitize WebKit bugs: use the DOM to normalize, then read back
    // This handles unclosed tags, mismatched nesting, text-align on spans, etc.
    const sanitizer = document.createElement('div');
    sanitizer.innerHTML = node.innerHTML;
    // Fix text-align on span → div (justifyCenter bug)
    for (const span of Array.from(sanitizer.querySelectorAll('span[style]')) as HTMLElement[]) {
      if (span.style.textAlign) {
        const div = document.createElement('div');
        div.style.cssText = span.style.cssText;
        div.innerHTML = span.innerHTML;
        span.replaceWith(div);
      }
    }
    // Reduce to the toolbar allowlist (strips anything unsafe or un-authorable)
    // so what we persist always matches what the editor can produce.
    onCommit(sanitizeRichText(sanitizer.innerHTML));
  }, [onCommit]);

  const commitAndClose = useCallback(() => {
    commitHtml();
    setEditing(false);
  }, [commitHtml]);

  // Commit any in-progress edit if this element UNMOUNTS while editing — entering
  // present mode (F5 / Present menu) unmounts the whole editor, and without this the
  // uncommitted typed text was lost (the blur/outside-click commit never fires).
  const pendingCommit = useRef<(() => void) | undefined>(undefined);
  pendingCommit.current = editing ? commitHtml : undefined;
  useEffect(() => () => { pendingCommit.current?.(); }, []);

  // Close editing when clicking outside this element
  useEffect(() => {
    if (!editing) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Stay open if clicking within our element or the toolbar
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest('.text-format-toolbar')) return;
      commitAndClose();
    };
    // Use capture so we see the event before stopPropagation in other handlers
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [editing, commitAndClose]);

  // Display mode: render as SVG/foreignObject so per-preset math fonts
  // composite into one self-contained element. The shared builder lives
  // in TextElementSvg.tsx so the editor, sidebar, present mode, and HTML
  // exports all produce identical SVG markup.
  if (!editing) {
    const svgMarkup = buildTextElementSvgMarkup(element, renderedHtml, {
      fontFamily, fontSize, fontWeight, fontStyle, color, valign,
      mono: resolveMonoFontPackage(presentation.config.defaultMonoFont).family,
    });
    return (
      <div
        ref={wrapperRef}
        style={{ width: '100%', height: '100%' }}
        onDoubleClick={() => startEditing()}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }

  return (
    // overflow:hidden on the edit wrapper — without it, contentEditable
    // text can paint past the slide-element bounds and leave ghost-text
    // traces when we switch back to the SVG display (the area outside the
    // wrapper isn't repainted by React's child swap, so old paint sticks
    // until something else triggers an invalidation). Display-mode wrapper
    // (above) keeps overflow visible so math glyph ink can overhang.
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {createPortal(
        <div style={{
          position: 'fixed', top: toolbarPos.top, left: toolbarPos.left,
          width: Math.max(toolbarPos.width, 500), zIndex: 9999,
        }}>
          <TextFormatToolbar onClose={commitAndClose} />
        </div>,
        document.body
      )}
      <div
        ref={setEditRef}
        style={style}
        contentEditable={editing}
        suppressContentEditableWarning
        onCopy={editing ? (e) => {
          // Prepend the eigendeck marker to the copied HTML so a
          // future paste into another eigendeck text element knows
          // the formatting is trusted and can be preserved. Also
          // sets text/plain so external apps get a clean paste.
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          e.preventDefault();
          const range = sel.getRangeAt(0);
          const container = document.createElement('div');
          container.appendChild(range.cloneContents());
          e.clipboardData?.setData('text/html', EIGENDECK_PASTE_MARKER + container.innerHTML);
          e.clipboardData?.setData('text/plain', sel.toString());
        } : undefined}
        onPaste={editing ? (e) => {
          // Default contenteditable paste inserts whatever HTML the
          // source app put on the clipboard — Word, Pages, browser
          // pages all push styled HTML that clobbers the slide's
          // typography. Restrict: trust HTML only when our own marker
          // is present (eigendeck → eigendeck round trip); otherwise
          // fall back to text/plain.
          const cb = e.clipboardData;
          if (!cb) return;
          e.preventDefault();
          const html = cb.getData('text/html');
          if (html && hasEigendeckMarker(html)) {
            // Even our own marked HTML is run through the allowlist — a crafted
            // deck could forge the marker, and it keeps paste consistent with edit.
            document.execCommand('insertHTML', false, sanitizeRichText(stripEigendeckMarker(html)));
          } else {
            const text = cb.getData('text/plain');
            if (text) document.execCommand('insertText', false, text);
          }
        } : undefined}
        onBlur={editing ? (e) => {
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.closest('.text-format-toolbar')) return;
          setTimeout(() => {
            if (!document.activeElement?.closest('.text-format-toolbar')) commitAndClose();
          }, 100);
        } : undefined}
        onInput={editing ? (e) => {
          if (ref.current) applyMathLineStyles(ref.current);
          // Auto-replace text patterns
          const inputData = (e.nativeEvent as InputEvent).data;
          if (!inputData) return;
          const trigger = inputData.slice(-1);
          if (!'->='.includes(trigger)) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
          const node = sel.anchorNode;
          if (node?.nodeType !== Node.TEXT_NODE) return;
          const text = node.textContent || '';
          const offset = sel.anchorOffset;
          // Two-stage: -- → en-dash, then en-dash + > → arrow
          // Ordered longest-first
          const replacements: [string, string][] = [
            ['\u2013>', '\u2192'],   // –> → →  (en-dash + >)
            ['<\u2013', '\u2190'],   // <– → ←
            ['\u2190>', '\u2194'],   // ←> → ↔  (left arrow + > = bidi arrow)
            ['<=>', '\u21D4'],       // <=> → ⇔
            ['=>', '\u21D2'],        // => → ⇒
            ['---', '\u2014'],       // --- → em-dash
            ['--', '\u2013'],        // -- → en-dash
          ];
          for (const [pattern, replacement] of replacements) {
            if (offset >= pattern.length && text.slice(offset - pattern.length, offset) === pattern) {
              const newText = text.slice(0, offset - pattern.length) + replacement + text.slice(offset);
              node.textContent = newText;
              // Position cursor after the replacement
              const newOffset = offset - pattern.length + replacement.length;
              const range = document.createRange();
              range.setStart(node, newOffset);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              break;
            }
          }
        } : undefined}
        onKeyDown={editing ? (e) => {
          if (e.key === 'Escape') commitAndClose();
          // Let Cmd+key shortcuts bubble for document-level handling,
          // but stop regular keys from triggering slide shortcuts (delete, etc.)
          if (!(e.metaKey || e.ctrlKey)) e.stopPropagation();
        } : undefined}
      />
    </div>
  );
}

// ============================================
// Draggable + resizable box
// ============================================
// Snap a slide-space coordinate to the alignment grid when snap-to-grid is on.
// `bypass` (⌘ held during the drag) skips snapping for free placement.
function snapCoord(v: number, bypass: boolean): number {
  if (bypass || !usePresentationStore.getState().snapToGrid) return v;
  return snapToGrid(v, getPreference('gridSpacing'));
}

export function DraggableBox({
  element, zIndex, scale, className, children, isSelected,
  dataValign, onEdit, boxStyle, rotation, onSelect, onDelete, onUpdate,
}: {
  // The id / position / link & sync ids and the position-commit all derive from
  // the element, so callers pass `element` + `onUpdate` instead of repeating the
  // seven-prop block at every box.
  element: { id: string; position: ElementPosition; linkId?: string; syncId?: string; _linkId?: string; _syncId?: string };
  zIndex: number; scale: number; className: string;
  children: React.ReactNode; isSelected: boolean;
  dataValign?: string;
  onEdit?: () => void;
  boxStyle?: React.CSSProperties;
  /** Rotation in degrees for the whole box (text/sticky-note tilt). */
  rotation?: number;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const elementId = element.id;
  const pos = element.position;
  const { linkId, syncId, _linkId, _syncId } = element;
  // Highlight this box while a context menu targets it (no selection change).
  const isContextTarget = useContextTarget() === elementId;
  const onPositionChange = (p: ElementPosition) => onUpdate({ position: p } as Partial<SlideElement>);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const lastDelta = useRef({ dx: 0, dy: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.el-resize-handle, .el-delete-btn, [contenteditable="true"]')) return;
      // Only the primary button selects/drags. A right-click (button 2) must reach
      // the context menu WITHOUT changing selection (Mac convention, #5).
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();

      // Shift+click toggles selection without starting drag
      if (e.shiftKey) {
        onSelect({ shiftKey: true });
        return;
      }

      // If not already selected, select it (clears multi-select)
      if (!isSelected) onSelect();

      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
      lastDelta.current = { dx: 0, dy: 0 };
      // Lazy: only start drag state and blocker on first actual movement
      let dragStarted = false;
      let blocker: HTMLDivElement | null = null;
      const ensureDragStarted = () => {
        if (!dragStarted) {
          dragStarted = true;
          setIsDragging(true);
          pauseUndo();
          blocker = document.createElement('div');
          blocker.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:grabbing;';
          document.body.appendChild(blocker);
        }
      };

      // Check if we're part of a multi-selection for group drag
      const sel = usePresentationStore.getState().selectedObject;
      const useMultiDrag = isSelected && sel?.type === 'multi' && sel.ids.includes(elementId);

      const DEAD_ZONE = 4; // px — ignore tiny movements (prevents drag on double-click)

      if (useMultiDrag && sel?.type === 'multi') {
        const ids = sel.ids;
        const handleMove = (me: PointerEvent) => {
          if (!dragStarted && Math.abs(me.clientX - dragStart.current.x) < DEAD_ZONE && Math.abs(me.clientY - dragStart.current.y) < DEAD_ZONE) return;
          ensureDragStarted();
          let dx = Math.round((me.clientX - dragStart.current.x) / scale);
          let dy = Math.round((me.clientY - dragStart.current.y) / scale);
          // Shift constrains to horizontal or vertical
          if (me.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          const ddx = dx - lastDelta.current.dx;
          const ddy = dy - lastDelta.current.dy;
          if (ddx !== 0 || ddy !== 0) {
            usePresentationStore.getState().moveElementsBy(ids, ddx, ddy);
            lastDelta.current = { dx, dy };
          }
        };
        const handleUp = () => {
          blocker?.remove();
          if (dragStarted) { setIsDragging(false); resumeUndo(); }
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
      } else {
        const handleMove = (me: PointerEvent) => {
          if (!dragStarted && Math.abs(me.clientX - dragStart.current.x) < DEAD_ZONE && Math.abs(me.clientY - dragStart.current.y) < DEAD_ZONE) return;
          ensureDragStarted();
          let newX = Math.round(dragStart.current.posX + (me.clientX - dragStart.current.x) / scale);
          let newY = Math.round(dragStart.current.posY + (me.clientY - dragStart.current.y) / scale);
          // Shift constrains to horizontal or vertical
          if (me.shiftKey) {
            const dx = Math.abs(newX - dragStart.current.posX);
            const dy = Math.abs(newY - dragStart.current.posY);
            if (dx > dy) newY = dragStart.current.posY;
            else newX = dragStart.current.posX;
          }
          onPositionChange({ ...pos, x: snapCoord(newX, me.metaKey), y: snapCoord(newY, me.metaKey) });
        };
        const handleUp = () => {
          blocker?.remove();
          if (dragStarted) { setIsDragging(false); resumeUndo(); }
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
      }
    },
    [elementId, pos, scale, isSelected, onSelect, onPositionChange]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); pauseUndo();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: pos.width, h: pos.height };
      // Block iframes from stealing pointer events during resize
      const blocker = document.createElement('div');
      blocker.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:nwse-resize;';
      document.body.appendChild(blocker);
      const handleMove = (me: PointerEvent) => {
        const rawW = resizeStart.current.w + (me.clientX - resizeStart.current.x) / scale;
        const rawH = resizeStart.current.h + (me.clientY - resizeStart.current.y) / scale;
        // #97: snap the moving EDGE (right/bottom) to the grid, not the size, so
        // the far edge lands on a gridline even when the origin is off-grid.
        const snapOn = !me.metaKey && usePresentationStore.getState().snapToGrid;
        const spacing = snapOn ? getPreference('gridSpacing') : 0;
        onPositionChange({
          ...pos,
          width: resizeEdgeToGrid(pos.x, rawW, spacing, 50),
          height: resizeEdgeToGrid(pos.y, rawH, spacing, 30),
        });
      };
      const handleUp = () => {
        blocker.remove();
        resumeUndo();
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [pos, scale, onPositionChange]
  );

  return (
    <div
      className={`slide-element ${className} ${isDragging ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isSelected && syncId ? 'is-synced' : ''}${isContextTarget ? ' context-target' : ''}`}
      data-element-id={elementId}
      data-valign={dataValign}
      style={{
        position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
        zIndex, cursor: isDragging ? 'grabbing' : 'grab',
        // Promote to its own compositor layer. Text SVGs use overflow="visible"
        // (required for italic-glyph ink overhang); without layer promotion,
        // WebKit doesn't invalidate ink painted outside the wrapper's layout
        // box when the element moves, leaving a ghost trace at the old
        // position. A separate compositor layer carries its full drawing
        // rect — overflow included — and moves as a clean unit. Issue #61.
        // A rotation (sticky-note tilt, #8) composes with the layer hint.
        transform: rotation ? `rotate(${rotation}deg) translateZ(0)` : 'translateZ(0)',
        ...boxStyle,
      }}
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Highlight the right-clicked element for the menu's lifetime so the
        // target is always visible — including when it's one of a multi-selection
        // (cleared on close by SlideEditor's context-menu-closed listener).
        setContextTarget(elementId);
        // Finder rule: right-clicking an item that's NOT already in the selection
        // selects it (so the menu acts on it); a right-click WITHIN an existing
        // (multi-)selection leaves the selection intact.
        if (!isSelected) onSelect();
        const store = usePresentationStore.getState();
        const items: import('./ContextMenu').MenuEntry[] = [
          ...(onEdit ? [
            { label: 'Edit Text', onClick: () => onEdit() },
            { separator: true as const },
          ] : []),
          { label: 'Cut', shortcut: '\u2318X', onClick: () => {
            // Copy then delete
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
            setTimeout(() => onDelete(), 50);
          }},
          { label: 'Copy', shortcut: '\u2318C', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
          }},
          { label: 'Paste', shortcut: '\u2318V', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
          }},
          { separator: true },
          { label: 'Delete', shortcut: '\u232B', onClick: onDelete },
          { separator: true },
          { label: 'Bring to Front', onClick: () => store.moveElementZ(elementId, 'top') },
          { label: 'Bring Forward', onClick: () => store.moveElementZ(elementId, 'up') },
          { label: 'Send Backward', onClick: () => store.moveElementZ(elementId, 'down') },
          { label: 'Send to Back', onClick: () => store.moveElementZ(elementId, 'bottom') },
          ...(syncId ? [
            { separator: true as const },
            { label: 'Free Position', onClick: () => store.freeElement(elementId) },
          ] : []),
          ...(linkId ? [
            { label: 'Unlink Animation', onClick: () => store.unlinkElement(elementId) },
          ] : []),
          { separator: true },
          { label: 'Properties', onClick: () => {
            if (!store.showProperties) store.toggleProperties();
          }},
        ];
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
      }}
    >
      {children}
      {/* Link badges — shown when selected */}
      {isSelected && (
        <div className="el-link-badges" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {/* Sync badge. Green = synced (click to free). Grey = either freed
              (click to re-sync) OR animation-linked-but-not-synced (click to
              PROMOTE link → sync, destructive). Hidden if there's no partner. */}
          {(syncId || _syncId || linkId) && (() => {
            const slides = usePresentationStore.getState().presentation.slides;
            const sid = syncId || _syncId;
            // A sync partner (synced/freed group) OR, for the promote case, an
            // animation-link partner sharing this linkId.
            //
            // Sync case: count the WHOLE group across slides — don't require a
            // DIFFERENT id. After save→reopen, synced instances correctly share
            // ONE canonical id (one row, many junctions — the storage model), so
            // an `el.id !== elementId` partner check finds nothing and wrongly
            // hides the S badge. A group of >1 instance always has a partner.
            const hasPartner = sid
              ? slides.reduce((n, s) => n + s.elements.filter((el) =>
                  el.syncId === sid || (el as any)._syncId === sid).length, 0) > 1
              : slides.some((s) => s.elements.some((el) =>
                  el.id !== elementId && el.linkId === linkId));
            if (!hasPartner) return null;
            const promote = !syncId && !_syncId;   // linked, not yet synced
            return (
              <button
                className={`el-link-badge ${syncId ? 'el-badge-sync' : 'el-badge-off'}`}
                title={syncId ? 'Synced — click to free position'
                  : promote ? 'Animation-linked — click to promote to a sync (makes the copies identical; destructive)'
                  : 'Position free — click to re-sync'}
                onClick={() => {
                  const store = usePresentationStore.getState();
                  if (syncId) store.freeElement(elementId);
                  else if (_syncId) store.resyncElement(elementId);
                  else {
                    // Promote link → sync. App decides: a recording conflict
                    // raises the "which to keep?" chooser; otherwise it confirms
                    // and promotes (keeping the only recording, if any).
                    window.dispatchEvent(new CustomEvent('promote-to-sync', { detail: { elementId } }));
                  }
                }}>
                S
              </button>
            );
          })()}
          {/* Animation badge: purple = active, grey = inactive */}
          {(linkId || _linkId) && (
            <button
              className={`el-link-badge ${linkId ? 'el-badge-anim' : 'el-badge-off'}`}
              title={linkId ? 'Animated — click to unlink' : 'Not animated — click to re-link'}
              onClick={() => {
                const store = usePresentationStore.getState();
                if (linkId) store.unlinkElement(elementId);
                else if (_linkId) store.relinkElement(elementId);
              }}>
              A
            </button>
          )}
          {/* Link button: open Time Machine overlay. Disabled for synced
              elements — sync and link are mutually exclusive: a synced element
              shares ONE position across slides, so there's no position delta to
              animate. Free it first to make it animatable. */}
          <button
            className="el-link-badge el-badge-link"
            disabled={!!syncId}
            title={syncId
              ? 'Synced elements share one position across slides — free it (S) first to animate'
              : 'Link to element on another slide'}
            onClick={() => {
              if (syncId) return;
              window.dispatchEvent(new CustomEvent('open-link-overlay', { detail: { elementId } }));
            }}>
            L
          </button>
        </div>
      )}
      <button className="el-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
      <div className="el-resize-handle" onPointerDown={handleResizeDown} />
    </div>
  );
}

// ============================================
// Arrow renderer
// ============================================
function ArrowRenderer({
  element: a, zIndex, scale, isSelected, theme, onUpdate, onDelete, onSelect,
}: {
  element: Extract<SlideElement, { type: 'arrow' }>; zIndex: number; scale: number;
  isSelected: boolean; theme?: ThemeColors;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void; onSelect: (e?: { shiftKey: boolean }) => void;
}) {
  const { x1, y1, x2, y2 } = a;
  const { color, strokeWidth, headSize, geo } = describeArrow(a, theme);
  const dragStart = useRef({ mx: 0, my: 0, ox1: 0, oy1: 0, ox2: 0, oy2: 0 });

  // Snap point to nearest 15° angle relative to an anchor
  const snapAngle = (px: number, py: number, ax: number, ay: number): [number, number] => {
    const adx = px - ax, ady = py - ay;
    const dist = Math.sqrt(adx * adx + ady * ady);
    if (dist < 1) return [px, py];
    const angle = Math.atan2(ady, adx);
    const step = Math.PI / 12; // 15°
    const snapped = Math.round(angle / step) * step;
    return [Math.round(ax + dist * Math.cos(snapped)), Math.round(ay + dist * Math.sin(snapped))];
  };

  const handleEndpoint = useCallback(
    (e: React.PointerEvent, which: 'start' | 'end') => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        let newX: number, newY: number;
        if (which === 'start') {
          newX = Math.round(dragStart.current.ox1 + dx);
          newY = Math.round(dragStart.current.oy1 + dy);
          if (me.shiftKey) [newX, newY] = snapAngle(newX, newY, dragStart.current.ox2, dragStart.current.oy2);
          onUpdate({ x1: newX, y1: newY } as any);
        } else {
          newX = Math.round(dragStart.current.ox2 + dx);
          newY = Math.round(dragStart.current.oy2 + dy);
          if (me.shiftKey) [newX, newY] = snapAngle(newX, newY, dragStart.current.ox1, dragStart.current.oy1);
          onUpdate({ x2: newX, y2: newY } as any);
        }
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, scale, onUpdate, onSelect]
  );

  const handleBody = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      // Capture the Bézier control points AND interior points so a body-drag
      // translates the WHOLE curve; without this the endpoints move but the
      // controls/waypoints stay put and the curve warps (#129 regression).
      const oc = { c1x: a.c1x, c1y: a.c1y, c2x: a.c2x, c2y: a.c2y };
      const opts = (a.points || []).map((p) => ({ ...p }));
      const handleMove = (me: PointerEvent) => {
        let dx = (me.clientX - dragStart.current.mx) / scale;
        let dy = (me.clientY - dragStart.current.my) / scale;
        // Shift constrains to horizontal or vertical
        if (me.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const upd: Record<string, unknown> = {
          x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy),
          x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy),
        };
        if (oc.c1x != null && oc.c1y != null) { upd.c1x = Math.round(oc.c1x + dx); upd.c1y = Math.round(oc.c1y + dy); }
        if (oc.c2x != null && oc.c2y != null) { upd.c2x = Math.round(oc.c2x + dx); upd.c2y = Math.round(oc.c2y + dy); }
        if (opts.length) upd.points = opts.map((p) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) }));
        onUpdate(upd as any);
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, a.c1x, a.c1y, a.c2x, a.c2y, a.points, scale, onUpdate, onSelect]
  );

  // Default control-handle positions — the 1/3 and 2/3 points on the straight
  // line, so an un-curved arrow's handles sit ON the line (invisible curve).
  // Dragging one materializes BOTH (a cubic needs all four) and bends the arrow.
  const c1dx = Math.round(x1 + (x2 - x1) / 3), c1dy = Math.round(y1 + (y2 - y1) / 3);
  const c2dx = Math.round(x1 + 2 * (x2 - x1) / 3), c2dy = Math.round(y1 + 2 * (y2 - y1) / 3);
  const c1hx = a.c1x ?? c1dx, c1hy = a.c1y ?? c1dy;
  const c2hx = a.c2x ?? c2dx, c2hy = a.c2y ?? c2dy;

  const handleControl = useCallback(
    (e: React.PointerEvent, which: 'c1' | 'c2') => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      const sMx = e.clientX, sMy = e.clientY;
      // Snapshot both control points (materializing defaults) so the first drag
      // produces a complete, valid cubic even from a straight arrow.
      const base = {
        c1x: a.c1x ?? Math.round(x1 + (x2 - x1) / 3), c1y: a.c1y ?? Math.round(y1 + (y2 - y1) / 3),
        c2x: a.c2x ?? Math.round(x1 + 2 * (x2 - x1) / 3), c2y: a.c2y ?? Math.round(y1 + 2 * (y2 - y1) / 3),
      };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - sMx) / scale, dy = (me.clientY - sMy) / scale;
        const moved = which === 'c1'
          ? { c1x: Math.round(base.c1x + dx), c1y: Math.round(base.c1y + dy) }
          : { c2x: Math.round(base.c2x + dx), c2y: Math.round(base.c2y + dy) };
        onUpdate({ ...base, ...moved } as any);
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, a.c1x, a.c1y, a.c2x, a.c2y, scale, onUpdate, onSelect]
  );

  // Double-click a control handle → straighten (clear control points AND waypoints).
  const straighten = useCallback(() => {
    onUpdate({ c1x: undefined, c1y: undefined, c2x: undefined, c2y: undefined, points: undefined } as any);
  }, [onUpdate]);

  // Drag an interior interpolation point (the curve passes through it; no handles).
  const handlePoint = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      const sMx = e.clientX, sMy = e.clientY;
      const pts = (a.points || []).map((p) => ({ ...p }));
      const base = pts[idx];
      if (!base) { resumeUndo(); return; }
      const bx = base.x, by = base.y;
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - sMx) / scale, dy = (me.clientY - sMy) / scale;
        const next = pts.map((p, i) => (i === idx ? { x: Math.round(bx + dx), y: Math.round(by + dy) } : p));
        onUpdate({ points: next } as any);
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [a.points, scale, onUpdate, onSelect]
  );
  // Double-click an interior point → remove it.
  const removePoint = useCallback((idx: number) => {
    const next = (a.points || []).filter((_, i) => i !== idx);
    onUpdate({ points: next.length ? next : undefined } as any);
  }, [a.points, onUpdate]);

  const bb = arrowBBox(x1, y1, x2, y2, headSize, a.heads, 30, a.c1x, a.c1y, a.c2x, a.c2y, a.points);
  const { minX, minY, maxX, maxY } = bb;

  return (
    <div className={`slide-element el-arrow ${isSelected ? 'is-selected' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey ? { shiftKey: true } : undefined); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSelected) onSelect();  // Finder rule: don't clobber an existing selection
        const store = usePresentationStore.getState();
        const items: import('./ContextMenu').MenuEntry[] = [
          { label: 'Cut', shortcut: '\u2318X', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
            setTimeout(() => onDelete(), 50);
          }},
          { label: 'Copy', shortcut: '\u2318C', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
          }},
          { separator: true },
          { label: 'Delete', shortcut: '\u232B', onClick: onDelete },
          { separator: true },
          { label: 'Bring to Front', onClick: () => store.moveElementZ(a.id, 'top') },
          { label: 'Bring Forward', onClick: () => store.moveElementZ(a.id, 'up') },
          { label: 'Send Backward', onClick: () => store.moveElementZ(a.id, 'down') },
          { label: 'Send to Back', onClick: () => store.moveElementZ(a.id, 'bottom') },
        ];
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
      }}
      style={{ position: 'absolute', left: minX, top: minY, width: maxX - minX, height: maxY - minY, pointerEvents: 'auto', zIndex }}>
      <svg width={maxX - minX} height={maxY - minY} style={{ overflow: 'visible' }}>
        {geo.curved
          ? <path d={geo.path} transform={`translate(${-minX} ${-minY})`} fill="none"
              stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={handleBody} />
          : <line x1={x1 - minX} y1={y1 - minY} x2={x2 - minX} y2={y2 - minY}
              stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={handleBody} />}
        <ArrowGlyph geo={geo} color={color} strokeWidth={strokeWidth} opacity={a.opacity}
          dx={minX} dy={minY} gStyle={{ pointerEvents: 'none' }} />
        {isSelected && (
          <g className="arrow-control-handles">
            {/* Inkscape-style handle lines from each endpoint to its control point. */}
            <line x1={x1 - minX} y1={y1 - minY} x2={c1hx - minX} y2={c1hy - minY}
              stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} style={{ pointerEvents: 'none' }} />
            <line x1={x2 - minX} y1={y2 - minY} x2={c2hx - minX} y2={c2hy - minY}
              stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} style={{ pointerEvents: 'none' }} />
            <circle cx={c1hx - minX} cy={c1hy - minY} r={6} fill={color} stroke="#fff" strokeWidth={2}
              className="arrow-control-handle" style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={(e) => handleControl(e, 'c1')} onDoubleClick={(e) => { e.stopPropagation(); straighten(); }} />
            <circle cx={c2hx - minX} cy={c2hy - minY} r={6} fill={color} stroke="#fff" strokeWidth={2}
              className="arrow-control-handle" style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={(e) => handleControl(e, 'c2')} onDoubleClick={(e) => { e.stopPropagation(); straighten(); }} />
          </g>
        )}
        {/* Interior interpolation points — on-curve dots the curve passes through
            (no handles). Drag to route; double-click to remove. Added via "+ Point". */}
        {isSelected && (a.points || []).map((p, i) => (
          <circle key={i} cx={p.x - minX} cy={p.y - minY} r={7} fill="#fff" stroke={color} strokeWidth={3}
            className="arrow-point" style={{ pointerEvents: 'all', cursor: 'move' }}
            onPointerDown={(e) => handlePoint(e, i)}
            onDoubleClick={(e) => { e.stopPropagation(); removePoint(i); }} />
        ))}
        <circle cx={x1 - minX} cy={y1 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'start')} />
        <circle cx={x2 - minX} cy={y2 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'end')} />
      </svg>
      {/* Same delete button as every other element (DraggableBox) — the shared
          .el-delete-btn CSS floats it above the wrapper's top-right corner and
          shows it on select/hover. The arrow wrapper is a positioned .slide-element,
          so no inline positioning needed (was a one-off centered/inline version). */}
      <button className="el-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
    </div>
  );
}
