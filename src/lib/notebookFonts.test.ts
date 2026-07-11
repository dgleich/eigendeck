import { describe, it, expect } from 'vitest';
import { fontForNotebookProse, fontForNotebookCode } from './notebookFonts';

describe('fontForNotebookProse', () => {
  it('walks slide → config → default (lato)', () => {
    expect(fontForNotebookProse(null, null).id).toBe('lato');
    expect(fontForNotebookProse(null, { defaultBodyFont: 'libertinus' }).id).toBe('libertinus');
    expect(fontForNotebookProse({ bodyFont: 'lm-sans' }, { defaultBodyFont: 'libertinus' }).id).toBe('lm-sans');
  });
});

describe('fontForNotebookCode', () => {
  it('defaults to source-code when no config tier specifies', () => {
    expect(fontForNotebookCode(null).id).toBe('source-code');
    expect(fontForNotebookCode({}).id).toBe('source-code');
  });

  it('falls back to source-code when defaultMonoFont is a non-mono id', () => {
    // libertinus is in the TEXT font registry, not MONO. The resolver
    // walks MONO_FONT_PACKAGES only, so unknown ids → source-code.
    expect(fontForNotebookCode({ defaultMonoFont: 'libertinus' }).id).toBe('source-code');
  });

  it('honors a registered mono font id', () => {
    // source-code is the only one currently registered; expand this
    // when more mono fonts are added.
    expect(fontForNotebookCode({ defaultMonoFont: 'source-code' }).id).toBe('source-code');
  });
});
