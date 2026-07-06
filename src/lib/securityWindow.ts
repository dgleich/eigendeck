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
    // Raise it to the top: unminimize (if minimized) + show (if hidden) + focus.
    // These require core:window:allow-{unminimize,show,set-focus} in the capability
    // (default.json) — without them the calls are DENIED by the ACL, which is what
    // made this silently do nothing before. Don't swallow errors: a rejected call
    // means a missing permission, and we want that to surface, not hide.
    await existing.unminimize();
    await existing.show();
    await existing.setFocus();
    await emitTo('security', 'security:init', payload);
    return;
  }

  // Register the ready-handshake listener BEFORE creating the window. The child
  // emits `security:ready` on mount; if we only start listening after creating it,
  // a fast child can fire first and we miss it — leaving the window stuck on
  // "Loading…" until a retrigger (the transient blank).
  //
  // Send `security:init` EXACTLY ONCE. Each init bumps the child's initKey and
  // REMOUNTS the app, so a second (redundant) init makes the window visibly blink.
  // The 1500ms timer is a FALLBACK for a missed ready event only — it no-ops once
  // the handshake has already sent.
  let sent = false;
  const sendInit = () => { if (sent) return; sent = true; void emitTo('security', 'security:init', payload).catch(() => {}); };
  const unlisten = await listen('security:ready', () => sendInit());
  setTimeout(() => { unlisten(); }, 15000);

  new WebviewWindow('security', {
    url: '/security.html',
    title: 'Security & linked files',
    width: 760,
    height: 660,
    resizable: true,
    focus: true,
  });

  setTimeout(() => sendInit(), 1500);  // fallback ONLY if `security:ready` never arrived
}
