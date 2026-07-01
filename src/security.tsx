/**
 * Security window entry point — the deck-wide "Linked files & security" window.
 *
 * Runs in its own webview (security.html). It receives the current deck
 * (presentation + projectPath) from the main window via a `security:init` event,
 * drops it into THIS window's store so buildDeckSecurityReport can read the deck
 * token / project dir / usage, then renders SecurityWindowApp. Ledger writes here
 * are shared (appData) and it emits `eigendeck:security-changed` so the main window
 * (which owns the watcher) re-scans. Mirrors src/presenter.tsx.
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { listen, emit } from '@tauri-apps/api/event';
import type { Presentation } from './types/presentation';
import { usePresentationStore } from './store/presentation';
import { SecurityWindowApp } from './components/SecurityPanel';
import { initRuntime } from './lib/runtime';

initRuntime();

function SecurityRoot(): React.ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<{ presentation: Presentation; projectPath: string | null }>(
        'security:init',
        (event) => {
          usePresentationStore.setState({
            presentation: event.payload.presentation,
            projectPath: event.payload.projectPath,
          });
          setReady(true);
        },
      );
      // Signal the main window we're mounted and listening.
      await emit('security:ready');
    })();
    return () => { unlisten?.(); };
  }, []);

  if (!ready) return <div style={{ padding: 20, color: '#999' }}>Loading…</div>;
  return <SecurityWindowApp />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<SecurityRoot />);
