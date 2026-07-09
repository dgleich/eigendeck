// Open (or focus) the independent Settings window.
//
// Mirrors src/lib/securityWindow.ts but simpler: Settings are app-level prefs
// in (shared) localStorage, so there's no deck init handshake — just create or
// raise the window. Cross-window pref propagation is handled centrally by the
// PREF_SYNC bridge (preferences.ts + initRuntime → initPrefSync).

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export async function openSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel('settings');
  if (existing) {
    // Raise it (needs core:window:allow-{unminimize,show,set-focus} in the
    // capability — same perms the security window relies on).
    await existing.unminimize();
    await existing.show();
    await existing.setFocus();
    return;
  }

  new WebviewWindow('settings', {
    url: '/settings.html',
    title: 'Settings',
    width: 640,
    height: 560,
    resizable: true,
    focus: true,
  });
}
