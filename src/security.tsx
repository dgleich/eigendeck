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
  // Bumped on every security:init. The main window re-sends init after it trusts the
  // deck (see App.tsx trust-request handler), so remounting SecurityWindowApp via this
  // key rebuilds the report against the now-trusted deck — deterministically, without
  // racing the store update against the report's own listeners.
  const [initKey, setInitKey] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<{ presentation: Presentation; projectPath: string | null }>(
        'security:init',
        async (event) => {
          usePresentationStore.setState({
            presentation: event.payload.presentation,
            projectPath: event.payload.projectPath,
          });
          // The main window may have just mutated the shared ledger (e.g. trusted
          // the deck in response to our request). Drop our stale cache so the
          // remounted report — and any approve/revoke we then do — reads fresh.
          const { invalidateLedgerCache } = await import('./lib/trustStore');
          invalidateLedgerCache();
          setReady(true);
          setInitKey((k) => k + 1);
        },
      );
      // Signal the main window we're mounted and listening.
      await emit('security:ready');
    })();
    return () => { unlisten?.(); };
  }, []);

  if (!ready) return <div style={{ padding: 20, color: '#999' }}>Loading…</div>;
  return <SecurityWindowApp key={initKey} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<SecurityRoot />);
