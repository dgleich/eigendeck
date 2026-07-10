// Reflect this webview window's focus onto a body class so the app chrome can
// render "subdued and visually farther away" while the window is inactive — the
// macOS convention (see the mac-assed checklist). Cross-platform via Tauri's
// focus event; native AppKit already de-emphasizes native controls, this covers
// the webview content. Runs in every window (main / settings / security) via
// initRuntime.
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Reflect focus state onto the document body. Pure; testable in jsdom. */
export function applyWindowFocus(focused: boolean): void {
  document.body.classList.toggle('window-inactive', !focused);
}

/** Wire this window's focus changes to the body class. Tauri's onFocusChanged is
 *  authoritative; DOM focus/blur is the fallback (covers plain-browser / dev). */
export function initWindowFocus(): void {
  window.addEventListener('focus', () => applyWindowFocus(true));
  window.addEventListener('blur', () => applyWindowFocus(false));
  applyWindowFocus(typeof document !== 'undefined' ? document.hasFocus() : true);
  try {
    const w = getCurrentWindow();
    void w.isFocused().then(applyWindowFocus).catch(() => {});
    void w.onFocusChanged(({ payload }) => applyWindowFocus(payload));
  } catch {
    /* not running under Tauri (tests / plain browser) */
  }
}
