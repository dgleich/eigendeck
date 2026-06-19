/**
 * Presenter window entry point.
 *
 * Runs on the secondary monitor (projector). Receives presentation data and
 * navigation commands from the main window via Tauri events, then renders the
 * slide through the SAME PresentSlideStage the single-window PresentMode uses —
 * so demos, notebooks, math, etc. render identically (no duplicate renderer to
 * drift out of sync).
 */
import { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { listen, emitTo } from '@tauri-apps/api/event';
import type { Presentation } from './types/presentation';
import { PresentSlideStage } from './components/PresentSlide';
import { injectFontFaces } from './lib/fonts';
import { discoverAllServers } from './lib/serverDiscovery';
import './App.css';

function PresenterApp() {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Receive presentation data + navigation from the main window.
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    (async () => {
      unsubs.push(await listen<{ presentation: Presentation; currentIndex: number; projectPath: string | null }>(
        'presenter:init', (event) => {
          setPresentation(event.payload.presentation);
          setCurrentIndex(event.payload.currentIndex);
        }));
      unsubs.push(await listen<{ index: number }>('presenter:goto', (event) => {
        setCurrentIndex(event.payload.index);
      }));
      unsubs.push(await listen<{ presentation: Presentation }>('presenter:update', (event) => {
        setPresentation(event.payload.presentation);
      }));
      await emitTo('main', 'presenter:ready', {});
    })();
    return () => { unsubs.forEach((fn) => fn()); };
  }, []);

  // Escape closes the presenter window.
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        await emitTo('main', 'presenter:closed', {});
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scale to fit the viewport.
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

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} ref={viewportRef}>
      <PresentSlideStage presentation={presentation} slide={slide} currentIndex={currentIndex} scale={scale} />
    </div>
  );
}

// The projector window is a SEPARATE webview, so it must do the same boot
// setup the main window does (src/main.tsx) — otherwise bundled fonts / math
// fonts don't load here and text renders with fallbacks (the 2-window-only
// "glitch" that didn't appear in single-window present). Server discovery lets
// live notebooks on the projector reach their kernels too.
injectFontFaces();
void discoverAllServers();

ReactDOM.createRoot(document.getElementById('root')!).render(<PresenterApp />);
