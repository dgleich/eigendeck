import { describe, it, expect } from 'vitest';
import { fontForNotebookProse, fontForNotebookCode } from './notebookFonts';

describe('fontForNotebookProse', () => {
  it('walks slide → config → ptsans default', () => {
    expect(fontForNotebookProse(null, null).id).toBe('ptsans');
    expect(fontForNotebookProse(null, { defaultBodyFont: 'libertinus' }).id).toBe('libertinus');
    expect(fontForNotebookProse({ bodyFont: 'lm-sans' }, { defaultBodyFont: 'libertinus' }).id).toBe('lm-sans');
  });
});

describe('fontForNotebookCode', () => {
  it('defaults to source-code when no config tier specifies', () => {
    expect(fontForNotebookCode(null).id).toBe('source-code');
    expect(fontForNotebookCode({}).id).toBe('source-code');
  });

  it('honors defaultMonoFont when set', () => {
    // Any registered package id works for the test — the resolver
    // only cares about lookup, not whether it's truly a monospace.
    expect(fontForNotebookCode({ defaultMonoFont: 'libertinus' }).id).toBe('libertinus');
  });
});
