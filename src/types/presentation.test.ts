import { describe, it, expect } from 'vitest';
import {
  createDefaultPresentation, createBlankSlide, NotebookElement, TextElement,
  resolveNamedSize, effectiveTextPresetSize, effectiveFontSize, DEFAULT_TEXT_SIZES,
} from './presentation';

describe('presentation types', () => {
  it('createDefaultPresentation returns valid structure', () => {
    const pres = createDefaultPresentation();
    expect(pres.title).toBe('Untitled Presentation');
    expect(pres.theme).toBe('white');
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].elements.length).toBeGreaterThan(0);
    expect(pres.slides[0].elements[0].type).toBe('text');
    expect(pres.config.width).toBe(1920);
    expect(pres.config.height).toBe(1080);
  });

  it('createBlankSlide generates unique ids', () => {
    const a = createBlankSlide();
    const b = createBlankSlide();
    expect(a.id).not.toBe(b.id);
    expect(a.notes).toBe('');
  });

  it('presentation.json roundtrips through JSON', () => {
    const pres = createDefaultPresentation();
    const json = JSON.stringify(pres);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe(pres.title);
    expect(parsed.slides).toHaveLength(pres.slides.length);
    expect(parsed.config).toEqual(pres.config);
  });

  it('NotebookElement roundtrips through JSON with both kernel kinds', () => {
    const external: NotebookElement = {
      id: 'nb-1', type: 'notebook',
      assetId: 'asset-1',
      kernel: { kind: 'external', kernelName: 'julia-1.10' },
      preamble: 'using LinearAlgebra',
      autoRun: true,
      position: { x: 100, y: 100, width: 800, height: 600 },
    };
    const lite: NotebookElement = {
      id: 'nb-2', type: 'notebook',
      assetId: 'asset-2',
      kernel: { kind: 'lite' },
      position: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    expect(JSON.parse(JSON.stringify(external))).toEqual(external);
    expect(JSON.parse(JSON.stringify(lite))).toEqual(lite);
  });

  it('NotebookElement with kernel absent is valid (resolves at render time)', () => {
    const el: NotebookElement = {
      id: 'nb-3', type: 'notebook',
      assetId: 'asset-3',
      position: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(el.kernel).toBeUndefined();
  });
});

describe('named text size system', () => {
  it('DEFAULT_TEXT_SIZES has the historical preset sizes', () => {
    expect(DEFAULT_TEXT_SIZES.footnote).toBe(24);
    expect(DEFAULT_TEXT_SIZES.note).toBe(32);
    expect(DEFAULT_TEXT_SIZES.body).toBe(48);
    expect(DEFAULT_TEXT_SIZES.title).toBe(72);
    expect(DEFAULT_TEXT_SIZES.hype).toBe(96);
  });

  it('resolveNamedSize returns deck override when set', () => {
    expect(resolveNamedSize('body', null)).toBe(48);
    expect(resolveNamedSize('body', {})).toBe(48);
    expect(resolveNamedSize('body', { textSizes: {} })).toBe(48);
    expect(resolveNamedSize('body', { textSizes: { body: 56 } })).toBe(56);
  });

  it('resolveNamedSize unaffected by overrides for other names', () => {
    expect(resolveNamedSize('note', { textSizes: { body: 56 } })).toBe(32);
  });

  it('effectiveTextPresetSize walks preset → sizeName → resolveNamedSize', () => {
    expect(effectiveTextPresetSize('title', null)).toBe(72);
    expect(effectiveTextPresetSize('body', null)).toBe(48);
    expect(effectiveTextPresetSize('annotation', null)).toBe(32); // annotation → 'note'
    expect(effectiveTextPresetSize('footnote', null)).toBe(24);
    expect(effectiveTextPresetSize('hype', null)).toBe(96);
    // textbox shares the 'body' size — deck override on body propagates
    expect(effectiveTextPresetSize('textbox', { textSizes: { body: 50 } })).toBe(50);
    // annotation maps to 'note' — overriding body doesn't change annotation
    expect(effectiveTextPresetSize('annotation', { textSizes: { body: 50 } })).toBe(32);
  });

  it('effectiveFontSize walks element override → fontSizeName → preset default', () => {
    const baseText: TextElement = {
      id: 't', type: 'text', preset: 'body', html: '',
      position: { x: 0, y: 0, width: 1, height: 1 },
    };
    // No override: preset 'body' resolves to body size (48 by default).
    expect(effectiveFontSize(baseText, null)).toBe(48);
    // Deck override on body propagates.
    expect(effectiveFontSize(baseText, { textSizes: { body: 56 } })).toBe(56);
    // fontSizeName on element overrides the preset's size.
    expect(effectiveFontSize({ ...baseText, fontSizeName: 'note' }, null)).toBe(32);
    expect(effectiveFontSize({ ...baseText, fontSizeName: 'note' },
      { textSizes: { note: 36 } })).toBe(36);
    // Numeric fontSize beats fontSizeName.
    expect(effectiveFontSize({ ...baseText, fontSize: 41, fontSizeName: 'note' }, null)).toBe(41);

    // Same logic, notebook flavor.
    const baseNb: NotebookElement = {
      id: 'n', type: 'notebook', assetId: 'a',
      position: { x: 0, y: 0, width: 1, height: 1 },
    };
    // No fields: 'note' default = 32.
    expect(effectiveFontSize(baseNb, null)).toBe(32);
    // Named override.
    expect(effectiveFontSize({ ...baseNb, fontSizeName: 'body' }, null)).toBe(48);
    // Numeric override wins.
    expect(effectiveFontSize({ ...baseNb, fontSize: 50, fontSizeName: 'body' }, null)).toBe(50);
  });

  it('TextElement.fontSizeName has the restricted union (no title, no hype)', () => {
    const a: TextElement = {
      id: 't', type: 'text', preset: 'body', html: '',
      position: { x: 0, y: 0, width: 1, height: 1 },
      fontSizeName: 'footnote',
    };
    expect(a.fontSizeName).toBe('footnote');
    // @ts-expect-error 'title' is not allowed on TextElement.fontSizeName either
    const _bad: TextElement = { ...a, fontSizeName: 'title' };
    void _bad;
  });

  it('NotebookElement.fontSizeName has the restricted union (no title, no hype)', () => {
    // Type-level check — these should compile.
    const a: NotebookElement = {
      id: 'n', type: 'notebook', assetId: 'a',
      position: { x: 0, y: 0, width: 1, height: 1 },
      fontSizeName: 'footnote',
    };
    const b: NotebookElement = { ...a, fontSizeName: 'note' };
    const c: NotebookElement = { ...a, fontSizeName: 'body' };
    expect([a, b, c].every((el) => el.fontSizeName !== undefined)).toBe(true);
    // @ts-expect-error 'title' is not assignable
    const _bad: NotebookElement = { ...a, fontSizeName: 'title' };
    void _bad;
  });
});
