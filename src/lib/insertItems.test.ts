import { describe, it, expect } from 'vitest';
import { INSERT_ITEMS, DEFAULT_HIDDEN_TOOLBAR_ITEMS } from './insertItems';

describe('insertItems default toolbar visibility', () => {
  it('hides Demo from the toolbar by default (power-user action, re-addable in Settings)', () => {
    expect(DEFAULT_HIDDEN_TOOLBAR_ITEMS).toContain('demo');
  });

  it('shows every non-power-user action by default', () => {
    // Only demo is default-hidden today; everything else is on the toolbar.
    for (const it of INSERT_ITEMS) {
      if (it.id === 'demo') continue;
      expect(DEFAULT_HIDDEN_TOOLBAR_ITEMS).not.toContain(it.id);
    }
  });

  it('every default-hidden id resolves to a real insert item', () => {
    const ids = new Set(INSERT_ITEMS.map((it) => it.id));
    for (const hidden of DEFAULT_HIDDEN_TOOLBAR_ITEMS) {
      expect(ids.has(hidden)).toBe(true);
    }
  });
});
