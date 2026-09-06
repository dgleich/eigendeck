// Unit tests for openSecurityWindow: the deck-wide "Linked files & security"
// window opener. Every Tauri boundary is mocked (WebviewWindow, listen/emitTo,
// the presentation store). These tests exercise the function's own logic —
// the focus-existing vs. create-new branch, the send-init-exactly-once guard,
// the "register the ready listener BEFORE creating the window" ordering, and
// the 1500ms fallback / 15000ms unlisten timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  ctor: vi.fn(),
  listen: vi.fn(),
  emitTo: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(h.ctor, { getByLabel: h.getByLabel }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: h.listen,
  emitTo: h.emitTo,
}));

vi.mock('../store/presentation', () => ({
  usePresentationStore: { getState: h.getState },
}));

import { openSecurityWindow } from './securityWindow';

const PRESENTATION = { id: 'deck-1', slides: [] };
const PROJECT_PATH = '/decks/talk.eigendeck';
const EXPECTED_PAYLOAD = { presentation: PRESENTATION, projectPath: PROJECT_PATH };

// The captured `security:ready` handler, so tests can fire the handshake.
let readyHandler: (() => void) | null = null;
// The unlisten fn returned to the function, so we can assert it gets called.
let unlisten: ReturnType<typeof vi.fn>;

function existingWindowStub() {
  return {
    unminimize: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readyHandler = null;
  unlisten = vi.fn();

  h.getState.mockReturnValue({ presentation: PRESENTATION, projectPath: PROJECT_PATH });
  h.emitTo.mockResolvedValue(undefined);
  h.listen.mockImplementation((_event: string, cb: () => void) => {
    readyHandler = cb;
    return Promise.resolve(unlisten);
  });
  // Default: no existing window.
  h.getByLabel.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openSecurityWindow — existing window branch', () => {
  it('raises the existing window (unminimize→show→setFocus) and re-inits it, without creating a new one', async () => {
    const win = existingWindowStub();
    h.getByLabel.mockResolvedValue(win);

    await openSecurityWindow();

    expect(h.getByLabel).toHaveBeenCalledWith('security');
    expect(win.unminimize).toHaveBeenCalledTimes(1);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.setFocus).toHaveBeenCalledTimes(1);
    // Order: unminimize before show before setFocus.
    expect(win.unminimize.mock.invocationCallOrder[0])
      .toBeLessThan(win.show.mock.invocationCallOrder[0]);
    expect(win.show.mock.invocationCallOrder[0])
      .toBeLessThan(win.setFocus.mock.invocationCallOrder[0]);

    expect(h.emitTo).toHaveBeenCalledTimes(1);
    expect(h.emitTo).toHaveBeenCalledWith('security', 'security:init', EXPECTED_PAYLOAD);

    // Focus branch returns early: no listener, no new window.
    expect(h.listen).not.toHaveBeenCalled();
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it('does not swallow a raise failure (missing ACL permission surfaces)', async () => {
    const win = existingWindowStub();
    win.setFocus.mockRejectedValue(new Error('window.set-focus not allowed'));
    h.getByLabel.mockResolvedValue(win);

    await expect(openSecurityWindow()).rejects.toThrow('set-focus not allowed');
    // Rejected before the re-init emit.
    expect(h.emitTo).not.toHaveBeenCalled();
  });
});

describe('openSecurityWindow — create new window branch', () => {
  it('registers the ready listener BEFORE constructing the window', async () => {
    await openSecurityWindow();

    expect(h.listen).toHaveBeenCalledTimes(1);
    expect((h.listen.mock.calls as unknown[][])[0][0]).toBe('security:ready');
    expect(h.ctor).toHaveBeenCalledTimes(1);
    expect(h.listen.mock.invocationCallOrder[0])
      .toBeLessThan(h.ctor.mock.invocationCallOrder[0]);
  });

  it('constructs the window with the expected label and options', async () => {
    await openSecurityWindow();

    const call = (h.ctor.mock.calls as unknown[][])[0];
    expect(call[0]).toBe('security');
    expect(call[1]).toEqual({
      url: '/security.html',
      title: 'Security & linked files',
      width: 760,
      height: 660,
      resizable: true,
      focus: true,
    });
  });

  it('sends security:init once when the ready handshake fires', async () => {
    await openSecurityWindow();
    expect(h.emitTo).not.toHaveBeenCalled(); // not until ready (or fallback)

    readyHandler!();
    await Promise.resolve(); // let the emitTo microtask settle

    expect(h.emitTo).toHaveBeenCalledTimes(1);
    expect(h.emitTo).toHaveBeenCalledWith('security', 'security:init', EXPECTED_PAYLOAD);
  });

  it('is idempotent: a second ready event does not re-init (the sent guard)', async () => {
    await openSecurityWindow();

    readyHandler!();
    readyHandler!();
    await Promise.resolve();

    expect(h.emitTo).toHaveBeenCalledTimes(1);
  });

  it('swallows an emitTo rejection from the ready handshake', async () => {
    h.emitTo.mockRejectedValue(new Error('emit failed'));
    await openSecurityWindow();

    // Firing ready must not produce an unhandled rejection / throw.
    expect(() => readyHandler!()).not.toThrow();
    await Promise.resolve();
    expect(h.emitTo).toHaveBeenCalledTimes(1);
  });

  it('builds the payload from the CURRENT store state at call time', async () => {
    h.getState.mockReturnValue({ presentation: { id: 'other' }, projectPath: null });
    await openSecurityWindow();
    readyHandler!();
    await Promise.resolve();

    expect(h.emitTo).toHaveBeenCalledWith('security', 'security:init', {
      presentation: { id: 'other' },
      projectPath: null,
    });
  });
});

describe('openSecurityWindow — timers', () => {
  it('the 1500ms fallback sends init when the ready event never arrives', async () => {
    vi.useFakeTimers();
    await openSecurityWindow();
    expect(h.emitTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1499);
    expect(h.emitTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(h.emitTo).toHaveBeenCalledTimes(1);
    expect(h.emitTo).toHaveBeenCalledWith('security', 'security:init', EXPECTED_PAYLOAD);
  });

  it('the fallback is a no-op once the handshake already sent (still exactly one init)', async () => {
    vi.useFakeTimers();
    await openSecurityWindow();

    readyHandler!();
    await Promise.resolve();
    expect(h.emitTo).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    expect(h.emitTo).toHaveBeenCalledTimes(1);
  });

  it('unlistens the ready handler after 15000ms', async () => {
    vi.useFakeTimers();
    await openSecurityWindow();

    expect(unlisten).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15000);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
