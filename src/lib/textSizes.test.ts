import { describe, it, expect } from 'vitest';
import { effectiveFontSize, resolveNamedSize, PRESET_SIZE_NAME, DEFAULT_TEXT_SIZES } from './textSizes.mjs';
import { TEXT_PRESET_STYLES, type TextPreset } from '../types/presentation';

// @simplify-guard — the shared text type-scale (lib/textSizes.mjs), the single
// source now used by both the app (types/presentation re-export) and the CLI
// export (exportCore.mjs). Pins the size cascade + the fix for the CLI size drift
// (named sizes / deck textSizes were ignored by exportCore's old el.fontSize ||
// ps.fontSize).
describe('[simplify-guard] textSizes', () => {
  it('effectiveFontSize cascade: explicit > named/textSizes > preset default', () => {
    // explicit numeric wins
    expect(effectiveFontSize({ type: 'text', preset: 'body', fontSize: 99 })).toBe(99);
    // named size resolves against the deck override
    expect(effectiveFontSize({ type: 'text', preset: 'body', fontSizeName: 'title' }, { textSizes: { title: 120 } })).toBe(120);
    // named size without override falls to the default scale
    expect(effectiveFontSize({ type: 'text', preset: 'body', fontSizeName: 'note' })).toBe(DEFAULT_TEXT_SIZES.note);
    // bare preset → its default size
    expect(effectiveFontSize({ type: 'text', preset: 'footnote' })).toBe(DEFAULT_TEXT_SIZES.footnote);
    // notebook → 'note'
    expect(effectiveFontSize({ type: 'notebook' })).toBe(DEFAULT_TEXT_SIZES.note);
  });

  it('honors a deck textSizes override on a bare preset (the CLI-drift fix)', () => {
    // body preset, no explicit size, deck shrinks the body scale → must follow it
    expect(effectiveFontSize({ type: 'text', preset: 'body' }, { textSizes: { body: 40 } })).toBe(40);
    expect(resolveNamedSize('body', { textSizes: { body: 40 } })).toBe(40);
  });

  it('PRESET_SIZE_NAME stays in sync with TEXT_PRESET_STYLES.sizeName', () => {
    for (const preset of Object.keys(TEXT_PRESET_STYLES) as TextPreset[]) {
      expect(PRESET_SIZE_NAME[preset]).toBe(TEXT_PRESET_STYLES[preset].sizeName);
    }
  });
});
