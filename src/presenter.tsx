/**
 * Projector window entry point (secondary monitor).
 *
 * #3 — same viewer as the main window: this renders the REAL <PresentMode>
 * (controlled by events), not a parallel renderer. It receives the
 * presentation + navigation from the main window via Tauri events, drops the
 * presentation into the store, and drives PresentMode's slide index through the
 * `controlledIndex` prop. Same transitions, same element rendering, same boot
 * (initRuntime) — so the projector can't drift from the single-window present.
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { listen, emitTo } from '@tauri-apps/api/event';
import type { Presentation } from './types/presentation';
import { PresentMode } from './components/PresentMode';
import { usePresentationStore } from './store/presentation';
import { initRuntime } from './lib/runtime';
import { warmMathCacheFromSqlite } from './lib/mathjaxRenderer';
import './App.css';

// Same boot as the main window (fonts + server discovery).
initRuntime();

function PresenterApp() {
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    (async () => {
      unsubs.push(await listen<{ presentation: Presentation; currentIndex: number; projectPath: string | null }>(
        'presenter:init', async (event) => {
          // Warm the math cache from the shared DB so PresentMode's text
          // renders from cached SVGs (cold projector would otherwise re-render
          // and time out on complex math — the raw-LaTeX spillover).
          try { await warmMathCacheFromSqlite(); } catch { /* best effort */ }
          // Populate THIS window's store so PresentMode reads the deck.
          usePresentationStore.setState({
            presentation: event.payload.presentation,
            currentSlideIndex: event.payload.currentIndex,
            projectPath: event.payload.projectPath,
          });
          setIndex(event.payload.currentIndex);
          setReady(true);
        }));
      unsubs.push(await listen<{ index: number }>('presenter:goto', (event) => {
        setIndex(event.payload.index);
      }));
      unsubs.push(await listen<{ presentation: Presentation }>('presenter:update', (event) => {
        usePresentationStore.setState({ presentation: event.payload.presentation });
      }));
      await emitTo('main', 'presenter:ready', {});
    })();
    return () => { unsubs.forEach((fn) => fn()); };
  }, []);

  const onExit = async () => {
    await emitTo('main', 'presenter:closed', {});
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  };

  if (!ready) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 24, fontFamily: 'system-ui' }}>
        Waiting for presentation...
      </div>
    );
  }

  return <PresentMode controlledIndex={index} onExit={onExit} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PresenterApp />);
