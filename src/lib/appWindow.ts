// Create one of the app's own windows (presenter, security, settings).
//
// Tauri reports a failed window creation ONLY through the new window's
// 'tauri://error' event. Without a listener the failure is silent: the window just
// never appears, and callers wait on a ready handshake that never comes. That is how
// #213 hid on the CI runner, where Tauri dropped the presenter and Security windows
// right after creating them.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

type WindowOptions = ConstructorParameters<typeof WebviewWindow>[1];

export function createAppWindow(label: string, options: WindowOptions): WebviewWindow {
  const win = new WebviewWindow(label, options);
  void win.once('tauri://error', (e) => console.error(`[window] could not create "${label}":`, e.payload));
  return win;
}
