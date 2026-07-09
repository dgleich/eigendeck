import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  effectiveAutoReload, getPreference, setPreference, initPrefSync, PREF_SYNC_EVENT,
} from './preferences';

// Mock the Tauri event module that setPreference/initPrefSync dynamically import,
// so the cross-window bridge is observable without a real Tauri runtime.
const emitMock = vi.fn((..._args: unknown[]) => Promise.resolve());
let listenHandler: ((e: { payload: { key?: string } }) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => emitMock(...args),
  listen: (_name: string, handler: (e: { payload: { key?: string } }) => void) => {
    listenHandler = handler;
    return Promise.resolve(() => {});
  },
}));

// Cascade is downward-only: any layer can refuse, no layer overrides
// a refusal above. Per-asset and per-presentation can opt OUT but not
// IN beyond what the layer above allows. The 'on' value is legal in
// the DB (legacy from earlier tri-state UI) but functionally treated
// as NULL.

describe('effectiveAutoReload', () => {
  describe('default-on cascade (global=true)', () => {
    it('returns true when all layers are NULL', () => {
      expect(effectiveAutoReload(null, null, true)).toBe(true);
    });

    it('returns true when undefined is passed (≡ NULL)', () => {
      expect(effectiveAutoReload(undefined, undefined, true)).toBe(true);
    });

    it('returns false when per-asset is "off"', () => {
      expect(effectiveAutoReload('off', null, true)).toBe(false);
    });

    it('returns false when per-presentation is "off"', () => {
      expect(effectiveAutoReload(null, 'off', true)).toBe(false);
    });

    it('returns false when both per-asset and per-presentation are "off"', () => {
      expect(effectiveAutoReload('off', 'off', true)).toBe(false);
    });
  });

  describe('default-off cascade (global=false)', () => {
    it('returns false even when nothing else is opted out', () => {
      expect(effectiveAutoReload(null, null, false)).toBe(false);
    });

    it('returns false when per-presentation is "off" (no change)', () => {
      expect(effectiveAutoReload(null, 'off', false)).toBe(false);
    });

    it('returns false when per-asset is "off" (no change)', () => {
      expect(effectiveAutoReload('off', null, false)).toBe(false);
    });
  });

  describe('downward-only — no layer can override an upper refusal', () => {
    it('per-presentation "on" CANNOT override global=false', () => {
      // Regression: in the earlier 3-state cascade, per-pres 'on'
      // overrode global. The simplified cascade drops that branch —
      // per-pres can opt out but not in.
      expect(effectiveAutoReload(null, 'on', false)).toBe(false);
    });

    it('per-asset "on" CANNOT override global=false', () => {
      // Regression: same shape for the per-asset layer. The cascade
      // ignores 'on' at the per-asset level entirely (treats it as null).
      expect(effectiveAutoReload('on', null, false)).toBe(false);
    });

    it('per-asset "on" CANNOT override per-presentation "off"', () => {
      // Asset can't opt in past a presentation-level opt-out.
      expect(effectiveAutoReload('on', 'off', true)).toBe(false);
    });
  });

  describe('legacy values from earlier UI', () => {
    it('treats per-asset "on" as if NULL (no effect; cascade decides)', () => {
      // Old tri-state UI wrote 'on' to mean "force watching." Under the
      // new cascade, 'on' is meaningless and ignored — same as NULL.
      // DB rows with auto_reload='on' should behave identically to NULL.
      const withOn = effectiveAutoReload('on', null, true);
      const withNull = effectiveAutoReload(null, null, true);
      expect(withOn).toBe(withNull);
    });

    it('treats per-presentation "on" as if absent', () => {
      const withOn = effectiveAutoReload(null, 'on', true);
      const withNull = effectiveAutoReload(null, null, true);
      expect(withOn).toBe(withNull);
    });

    it('"off" still wins over legacy "on" at the same layer', () => {
      // (Impossible in practice — a row can have only one auto_reload
      // value — but verifying the semantic by passing 'off' instead.)
      expect(effectiveAutoReload('off', 'on', true)).toBe(false);
    });
  });

  describe('unrecognized values', () => {
    it('treats unknown string at per-asset as if NULL', () => {
      expect(effectiveAutoReload('garbage', null, true)).toBe(true);
    });

    it('treats unknown string at per-presentation as if NULL', () => {
      expect(effectiveAutoReload(null, 'garbage', true)).toBe(true);
    });

    it('empty string is not "off"', () => {
      expect(effectiveAutoReload('', null, true)).toBe(true);
    });
  });
});

describe('gridSpacing preference', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to 30px when unset (slide center 960×540 is a grid point at 30)', () => {
    expect(getPreference('gridSpacing')).toBe(30);
  });

  it('round-trips a custom spacing', () => {
    setPreference('gridSpacing', 80);
    expect(getPreference('gridSpacing')).toBe(80);
  });
});

// The Settings window (src/settings.tsx) and the main window are separate
// webviews. localStorage is shared (same origin) but the DOM CHANGE_EVENT is
// per-document, so setPreference broadcasts a Tauri event and initPrefSync()
// re-dispatches it locally in every window. Without this, a pref changed in the
// Settings window wouldn't update usePreference() in the main window.
describe('cross-window pref sync (PREF_SYNC bridge)', () => {
  beforeEach(() => { localStorage.clear(); emitMock.mockClear(); listenHandler = null; });

  it('setPreference fires the local pref-changed DOM event (usePreference reacts)', () => {
    const changed: string[] = [];
    const h = (e: Event) => changed.push((e as CustomEvent).detail?.key);
    window.addEventListener('eigendeck:pref-changed', h);
    setPreference('gridSpacing', 55);
    window.removeEventListener('eigendeck:pref-changed', h);
    expect(changed).toContain('gridSpacing');
  });

  it('setPreference broadcasts PREF_SYNC to other windows with the key', async () => {
    setPreference('gridSpacing', 60);
    // the emit is behind a dynamic import().then — let the microtasks flush
    await vi.waitFor(() => expect(emitMock).toHaveBeenCalledWith(PREF_SYNC_EVENT, { key: 'gridSpacing' }));
  });

  it('initPrefSync re-dispatches a received PREF_SYNC as a local pref-changed event', async () => {
    initPrefSync();
    await vi.waitFor(() => expect(listenHandler).not.toBeNull());
    const changed: string[] = [];
    const h = (e: Event) => changed.push((e as CustomEvent).detail?.key);
    window.addEventListener('eigendeck:pref-changed', h);
    listenHandler!({ payload: { key: 'showHelpText' } });
    window.removeEventListener('eigendeck:pref-changed', h);
    expect(changed).toEqual(['showHelpText']);
  });
});
