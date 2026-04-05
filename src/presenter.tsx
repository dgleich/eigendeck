/**
 * Presenter window entry point.
 *
 * Runs on the secondary monitor (projector). Receives presentation data
 * and navigation commands from the main window via Tauri events.
 */
import { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { listen, emitTo } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { TEXT_PRESET_STYLES, getSlideNumber } from './types/presentation';
import { typesetElement, resetMathElement, containsMath } from './lib/mathjax';
import type { Presentation, SlideElement, TextElement } from './types/presentation';
import './App.css';

function PresenterApp() {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Receive presentation data from main window
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    (async () => {
      // Receive full presentation data
      unsubs.push(await listen<{ presentation: Presentation; currentIndex: number; projectPath: string | null }>(
        'presenter:init', (event) => {
          setPresentation(event.payload.presentation);
          setCurrentIndex(event.payload.currentIndex);
          setProjectPath(event.payload.projectPath);
        }
      ));

      // Navigation commands
      unsubs.push(await listen<{ index: number }>('presenter:goto', (event) => {
        setCurrentIndex(event.payload.index);
      }));

      // Presentation data updates (e.g. if edited while presenting)
      unsubs.push(await listen<{ presentation: Presentation }>('presenter:update', (event) => {
        setPresentation(event.payload.presentation);
      }));

      // Tell main window we're ready
      await emitTo('main', 'presenter:ready', {});
    })();

    return () => { unsubs.forEach((fn) => fn()); };
  }, []);

  // Escape key closes the presenter window
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Tell main window we're closing
        await emitTo('main', 'presenter:closed', {});
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scale to fit viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !presentation) return;
    const slideW = presentation.config.width;
    const slideH = presentation.config.height;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setScale(Math.min(width / slideW, height / slideH));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [presentation]);

  if (!presentation) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 24, fontFamily: 'system-ui' }}>
        Waiting for presentation...
      </div>
    );
  }

  const slide = presentation.slides[currentIndex];
  if (!slide) return null;

  const slideW = presentation.config.width;
  const slideH = presentation.config.height;
  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} ref={viewportRef}>
      <div style={{ width: slideW * scale, height: slideH * scale }}>
        <div
          className={`present-slide slide-layout-${slide.layout || 'default'}`}
          style={{ width: slideW, height: slideH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {slide.elements.map((el, idx) => (
            <PresenterElement key={el.id} element={el} zIndex={idx + 10} projectPath={projectPath} />
          ))}
          <div className="slide-footer" style={{ zIndex: 1000 }}>
            <span className="slide-footer-meta">{meta}</span>
            <span className="slide-footer-number">{getSlideNumber(presentation.slides, currentIndex)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresenterElement({ element: el, zIndex, projectPath }: { element: SlideElement; zIndex: number; projectPath: string | null }) {
  const pos = el.position;

  switch (el.type) {
    case 'text':
      return <PresenterTextElement element={el} zIndex={zIndex} />;

    case 'image': {
      let src = el.src;
      if (!src.startsWith('data:') && projectPath) {
        try { src = convertFileSrc(`${projectPath}/${el.src}`); } catch { /* keep original */ }
      }
      return (
        <img src={src} alt="" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          objectFit: 'contain', zIndex,
        }} />
      );
    }

    case 'demo': {
      let src: string | undefined;
      if (projectPath) { try { src = convertFileSrc(`${projectPath}/${el.src}`); } catch { /* skip */ } }
      if (!src) return null;
      return (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title="demo" style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          border: 'none', zIndex,
        }} />
      );
    }

    case 'demo-piece': {
      let src: string | undefined;
      if (projectPath) { try { src = convertFileSrc(`${projectPath}/${el.demoSrc}`) + `#piece=${el.piece}`; } catch { /* skip */ } }
      if (!src) return null;
      return (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title={`demo-piece: ${el.piece}`} style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          border: 'none', zIndex,
        }} />
      );
    }

    case 'cover':
      return (
        <div style={{
          position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
          background: el.color || '#ffffff', zIndex,
        }} />
      );

    case 'arrow': {
      const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      return (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} />
          <polygon points={`${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}`} fill={color} />
        </svg>
      );
    }
  }
}

function PresenterTextElement({ element: el, zIndex }: { element: TextElement; zIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = el.position;
  const preset = TEXT_PRESET_STYLES[el.preset];

  useEffect(() => {
    if (ref.current) {
      resetMathElement(ref.current, el.html);
      if (containsMath(el.html)) {
        typesetElement(ref.current);
      }
    }
  }, [el.html]);

  return (
    <div ref={ref} className={`el-text el-preset-${el.preset}`} style={{
      position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
      fontFamily: el.fontFamily || preset.fontFamily,
      fontSize: el.fontSize || preset.fontSize,
      fontWeight: preset.fontWeight,
      fontStyle: preset.fontStyle,
      color: el.color || preset.color,
      lineHeight: 1.3,
      padding: '8px 12px',
      overflow: 'hidden',
      zIndex,
    }} />
  );
}

// Mount
ReactDOM.createRoot(document.getElementById('root')!).render(<PresenterApp />);
