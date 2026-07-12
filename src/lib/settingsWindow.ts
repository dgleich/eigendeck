// Open (or focus) the independent Settings window.
//
// Mirrors src/lib/securityWindow.ts but simpler: Settings are app-level prefs
// in (shared) localStorage, so there's no deck init handshake — just create or
// raise the window. Cross-window pref propagation is handled centrally by the
// PREF_SYNC bridge (preferences.ts + initRuntime → initPrefSync).

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { SettingsTab } from '../components/SettingsModal';

/** Open (or focus) the Settings window. `tab` deep-links to a section — a fresh
 *  window carries it in the URL hash; an already-open window is told via the
 *  `settings-tab` event (settings.tsx bridges it to the panel). */
export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  const existing = await WebviewWindow.getByLabel('settings');
  if (existing) {
    // Raise it (needs core:window:allow-{unminimize,show,set-focus} in the
    // capability — same perms the security window relies on).
    await existing.unminimize();
    await existing.show();
    await existing.setFocus();
    if (tab) await existing.emit('settings-tab', tab);
    return;
  }

  new WebviewWindow('settings', {
    url: tab ? `/settings.html#${tab}` : '/settings.html',
    title: 'Settings',
    width: 640,
    height: 560,
    resizable: true,
    focus: true,
  });
}
