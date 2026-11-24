// createAppWindow: a failed window creation must be reported, not silent (#213).
// Tauri signals that only through the window's 'tauri://error' event.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const handlers: Record<string, (e: { payload: unknown }) => void> = {};
  const instance = { once: vi.fn((ev: string, cb: (e: { payload: unknown }) => void) => { handlers[ev] = cb; return Promise.resolve(() => {}); }) };
  return { handlers, instance, ctor: vi.fn(function () { return instance; }) };
});

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: h.ctor }));

import { createAppWindow } from './appWindow';

describe('createAppWindow', () => {
  beforeEach(() => { h.ctor.mockClear(); h.instance.once.mockClear(); });

  it('creates the window with the given label and options', () => {
    const w = createAppWindow('presenter', { url: '/presenter.html' });
    expect(h.ctor).toHaveBeenCalledWith('presenter', { url: '/presenter.html' });
    expect(w).toBe(h.instance);
  });

  it('logs a creation failure with the window label', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    createAppWindow('security', { url: '/security.html' });
    expect(h.instance.once).toHaveBeenCalledWith('tauri://error', expect.any(Function));
    h.handlers['tauri://error']({ payload: 'webview creation failed' });
    expect(err).toHaveBeenCalledWith('[window] could not create "security":', 'webview creation failed');
    err.mockRestore();
  });
});
