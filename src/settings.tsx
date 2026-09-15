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
import { installCoverageBeacon } from './lib/coverageBeacon';

initRuntime();
// E2E coverage: this window's own __coverage__ → collector (no-op in normal builds).
installCoverageBeacon();

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

window.addEventListener('keydown', (e) => {
  // Esc closes the window (native Cmd+W also works via the menu).
  if (e.key === 'Escape') { e.preventDefault(); void getCurrentWindow().close(); return; }
  // Cmd/Ctrl+A in a text field selects its text. WKWebView (macOS) routes a
  // field's Cmd+A through the native Edit menu's selectAll:, which our custom
  // accelerator-less menu doesn't provide, so the field's native select-all never
  // fires; do it in JS (harmless on Linux/Windows, which do it in-engine). Same
  // fix as the main window's selectAllAction field case (this window has no App).
  if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      e.preventDefault();
      (el as HTMLInputElement).select?.();
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(<SettingsRoot />);
