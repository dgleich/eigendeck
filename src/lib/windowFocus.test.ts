import { describe, it, expect, beforeEach } from 'vitest';
import { applyWindowFocus } from './windowFocus';

describe('applyWindowFocus', () => {
  beforeEach(() => { document.body.className = ''; });

  it('adds window-inactive when the window loses focus', () => {
    applyWindowFocus(false);
    expect(document.body.classList.contains('window-inactive')).toBe(true);
  });

  it('removes window-inactive when the window regains focus', () => {
    applyWindowFocus(false);
    applyWindowFocus(true);
    expect(document.body.classList.contains('window-inactive')).toBe(false);
  });

  it('is idempotent', () => {
    applyWindowFocus(false);
    applyWindowFocus(false);
    expect(document.body.className.match(/window-inactive/g)?.length).toBe(1);
  });
});
