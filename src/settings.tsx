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
import { listen } from '@tauri-apps/api/event';
import { SettingsPanel } from './components/SettingsModal';
import { initRuntime } from './lib/runtime';

initRuntime();

// Deep-link: when the window is already open, the main window emits `settings-tab`
// to switch tabs (e.g. View → Customize Toolbar… → `ui`). Bridge it to the plain
// window event SettingsPanel listens for (keeps the panel free of Tauri imports).
void listen<string>('settings-tab', (e) => {
  window.dispatchEvent(new CustomEvent('eigendeck:settings-tab', { detail: e.payload }));
});

function SettingsRoot(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* No in-window "Settings" heading — the native window title says it. The
          tab bar sits at the top with a little breathing room. */}
      <SettingsPanel header={<div style={{ height: 10 }} />} />
    </div>
  );
}

// Esc closes the window (native Cmd+W also works via the menu).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); void getCurrentWindow().close(); }
});

ReactDOM.createRoot(document.getElementById('root')!).render(<SettingsRoot />);
