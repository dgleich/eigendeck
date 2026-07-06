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
    // Raise it to the top. On macOS setFocus() alone often WON'T lift a window
    // owned by another window (the case here — we're calling from the main
    // window), so unminimize + show, then a brief always-on-top PULSE forces it
    // to the front, then setFocus for keyboard focus. The pulse is the documented
    // workaround for Tauri's "window won't come forward on macOS" behavior.
    await existing.unminimize().catch(() => {});
    await existing.show().catch(() => {});
    await existing.setAlwaysOnTop(true).catch(() => {});
    await existing.setFocus().catch(() => {});
    await existing.setAlwaysOnTop(false).catch(() => {});
    await emitTo('security', 'security:init', payload).catch(() => {});
    return;
  }

  // Register the ready-handshake listener BEFORE creating the window. The child
  // emits `security:ready` on mount; if we only start listening after creating it,
  // a fast child can fire first and we miss it — leaving the window stuck on
  // "Loading…" until a retrigger (the transient blank). Respond to every ready by
  // (re)sending the deck; the child's init is idempotent (it just rebuilds).
  const unlisten = await listen('security:ready', () => {
    void emitTo('security', 'security:init', payload).catch(() => {});
  });
  setTimeout(() => { unlisten(); }, 15000);

  new WebviewWindow('security', {
    url: '/security.html',
    title: 'Security & linked files',
    width: 760,
    height: 660,
    resizable: true,
    focus: true,
  });

  // Belt-and-suspenders: also push the deck a moment after creation in case the
  // ready event was missed entirely (idempotent with the listener above).
  setTimeout(() => { void emitTo('security', 'security:init', payload).catch(() => {}); }, 1200);
}
