import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore, seedUndoHistory } from './presentation';
import type { Presentation } from '../types/presentation';

// Security regression: cross-session undo reconstructs historical deck states via a
// SEPARATE path from the on-open sanitize sweep. A crafted/shared .eigendeck can hold
// benign CURRENT text (passes the sweep) but an earlier temporal row carrying
// executable markup; seedUndoHistory reconstructs that row into zundo's undo stack.
// Pressing Undo then installs it, and the raw dangerouslySetInnerHTML sinks (text
// display / link overlay / speaker view) execute it in the privileged frame. The
// seed path MUST apply the same toolbar allowlist as the on-open load.

// A historical presentation whose text element html carries an onerror XSS payload.
const MALICIOUS_HISTORY: Presentation = {
  title: 'Deck',
  theme: 'white',
  config: {},
  slides: [
    {
      id: 's0',
      notes: '',
      elements: [
        {
          id: 't1',
          type: 'text',
          preset: 'body',
          // <img onerror> fires on innerHTML insertion; <b> is allowlisted and survives.
          html: '<img src=x onerror="window.__PWNED=1"><b>ok</b>',
          position: { x: 0, y: 0, width: 100, height: 50 },
        },
      ],
    },
  ],
} as unknown as Presentation;

describe('seedUndoHistory — sanitizes reconstructed history (XSS-on-undo bypass)', () => {
  beforeEach(() => {
    usePresentationStore.temporal.getState().clear();
    vi.mocked(invoke).mockReset();
    // Two edit points: prior = [t1] (the malicious one), latest = t2 (== current, dropped).
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'db_get_history_timestamps') {
        return JSON.stringify([{ timestamp: 't1' }, { timestamp: 't2' }]);
      }
      if (cmd === 'db_get_state_at') {
        expect(args?.at).toBe('t1');
        return JSON.stringify(MALICIOUS_HISTORY);
      }
      return undefined;
    });
  });

  it('strips executable markup from the seeded undo snapshots', async () => {
    const n = await seedUndoHistory();
    expect(n).toBe(1); // the one prior point was reconstructed + seeded

    const past = usePresentationStore.temporal.getState().pastStates as Array<{ presentation: Presentation }>;
    expect(past.length).toBe(1);
    const html = (past[0].presentation.slides[0].elements[0] as { html?: string }).html || '';

    // The payload must be gone; the benign allowlisted markup survives.
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('ok');
  });
});
