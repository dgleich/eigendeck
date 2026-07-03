// Open (or focus) the deck-wide "Linked files & security" window.
//
// Mirrors the presenter-window pattern (src/lib/multiMonitor.ts): create a
// WebviewWindow pointing at security.html, wait for its `security:ready` handshake,
// then push the current deck (presentation + projectPath) via `security:init` so the
// window's store can build the report. Focuses the existing window if already open.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, emitTo } from '@tauri-apps/api/event';
import { usePresentationStore } from '../store/presentation';

export async function openSecurityWindow(): Promise<void> {
  const store = usePresentationStore.getState();
  const payload = { presentation: store.presentation, projectPath: store.projectPath };

  const existing = await WebviewWindow.getByLabel('security');
  if (existing) {
    await existing.setFocus().catch(() => {});
    await emitTo('security', 'security:init', payload).catch(() => {});
    return;
  }

  new WebviewWindow('security', {
    url: '/security.html',
    title: 'Security & linked files',
    width: 760,
    height: 660,
    resizable: true,
    focus: true,
  });

  // Handshake: the window emits `security:ready` on mount; then we send the deck.
  const ready = new Promise<void>((resolve) => {
    listen('security:ready', () => resolve()).then((un) => setTimeout(un, 8000));
  });
  await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 8000))]);
  await emitTo('security', 'security:init', payload).catch(() => {});
}
