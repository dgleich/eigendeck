/**
 * Settings window entry point — the independent app-preferences window.
 *
 * Runs in its own webview (settings.html), mirroring the Security window
 * (src/security.tsx). Settings are app-level prefs stored in localStorage
 * (shared across same-origin webview windows); writes here reach the main
 * window via the PREF_SYNC cross-window bridge (see preferences.ts +
 * initRuntime → initPrefSync). No deck init handshake is needed — the panel
 * reads/writes prefs directly.
 *
 * See github.com/dgleich/eigendeck/issues/62 (was: webview modal).
 */
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SettingsPanel } from './components/SettingsModal';
import { initRuntime } from './lib/runtime';

initRuntime();

function SettingsRoot(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SettingsPanel header={
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
          fontSize: 15, fontWeight: 600,
        }}>Settings</div>
      } />
    </div>
  );
}

// Esc closes the window (native Cmd+W also works via the menu).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); void getCurrentWindow().close(); }
});

ReactDOM.createRoot(document.getElementById('root')!).render(<SettingsRoot />);
