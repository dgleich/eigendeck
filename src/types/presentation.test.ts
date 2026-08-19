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

  it('NotebookElement cellEdits overlay roundtrips through JSON', () => {
    const el: NotebookElement = {
      id: 'nb-e', type: 'notebook', assetId: 'asset-e',
      position: { x: 0, y: 0, width: 100, height: 100 },
      cellEdits: { 0: 'k = 10', 3: 'import numpy as np\nnp.zeros(5)' },
    };
    const parsed = JSON.parse(JSON.stringify(el)) as NotebookElement;
    expect(parsed.cellEdits?.[0]).toBe('k = 10');
    expect(parsed.cellEdits?.[3]).toBe('import numpy as np\nnp.zeros(5)');
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
    expect(DEFAULT_TEXT_SIZES.hype).toBe(48);
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
    expect(effectiveTextPresetSize('hype', null)).toBe(48); // hype → its own 'hype' size (default 48)
    // textbox shares the 'body' size — deck override on body propagates
    expect(effectiveTextPresetSize('textbox', { textSizes: { body: 50 } })).toBe(50);
    // annotation maps to 'note' — overriding body doesn't change annotation
    expect(effectiveTextPresetSize('annotation', { textSizes: { body: 50 } })).toBe(32);
    // hype maps to its own 'hype' size — the deck's Hype size row drives hype elements
    expect(effectiveTextPresetSize('hype', { textSizes: { hype: 120 } })).toBe(120);
    // ...and overriding body does NOT change hype (regression guard for the dead-control bug)
    expect(effectiveTextPresetSize('hype', { textSizes: { body: 50 } })).toBe(48);
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

describe('parsePalette (#2 custom palette)', () => {
  it('parses comma / space / newline separated hex with or without #', async () => {
    const { parsePalette } = await import('./presentation');
    expect(parsePalette('#ff0000, #00ff00 #0000ff')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(parsePalette('ff0000\n00ff00')).toEqual(['#ff0000', '#00ff00']);
  });
  it('expands 3-digit shorthand and lowercases', async () => {
    const { parsePalette } = await import('./presentation');
    expect(parsePalette('#ABC #F00')).toEqual(['#aabbcc', '#ff0000']);
  });
  it('dedupes order-preserving and skips junk', async () => {
    const { parsePalette } = await import('./presentation');
    expect(parsePalette('#fff, white, #FFF, notacolor, #123456')).toEqual(['#ffffff', '#123456']);
  });
  it('caps the count', async () => {
    const { parsePalette } = await import('./presentation');
    const many = Array.from({ length: 50 }, (_, i) => '#' + i.toString(16).padStart(6, '0')).join(' ');
    expect(parsePalette(many, 8)).toHaveLength(8);
  });
  it('returns [] for empty', async () => {
    const { parsePalette } = await import('./presentation');
    expect(parsePalette('')).toEqual([]);
  });
});

describe('textEffectCss (#73 text shadow/glow)', () => {
  it('returns undefined for no effect', async () => {
    const { textEffectCss } = await import('./presentation');
    expect(textEffectCss(undefined, '#000000')).toBeUndefined();
  });
  it('shadow is a fixed drop shadow', async () => {
    const { textEffectCss } = await import('./presentation');
    expect(textEffectCss('shadow', '#123456')).toBe('0 2px 4px rgba(0,0,0,0.45)');
  });
  it('glow halo is white for dark text, black for light text', async () => {
    const { textEffectCss } = await import('./presentation');
    expect(textEffectCss('glow', '#111111')).toContain('#ffffff');
    expect(textEffectCss('glow', '#eeeeee')).toContain('#000000');
  });
  it('glow falls back to white halo for non-hex colors', async () => {
    const { textEffectCss } = await import('./presentation');
    expect(textEffectCss('glow', 'rebeccapurple')).toContain('#ffffff');
  });
});

describe('text element rotation (#8 angled callouts)', () => {
  it('hype defaults to a -4° tilt + yellow background', async () => {
    const { createTextElement } = await import('./presentation');
    const h = createTextElement('hype');
    expect(h.rotation).toBe(-4);
    expect(h.backgroundColor).toBe('#fde047');
  });
  it('non-hype text presets have no rotation by default', async () => {
    const { createTextElement } = await import('./presentation');
    for (const p of ['title', 'body', 'textbox', 'annotation', 'footnote'] as const) {
      expect(createTextElement(p).rotation).toBeUndefined();
    }
  });
});

describe('textShadowCss / textBoxShadowCss (independent text vs box shadow)', () => {
  it('textEffect drives the text shadow, independent of background', async () => {
    const { textShadowCss } = await import('./presentation');
    expect(textShadowCss({ textEffect: 'shadow' }, '#000')).toBe('0 2px 4px rgba(0,0,0,0.45)');
    // still a text-shadow even with a background (the box shadow is separate now)
    expect(textShadowCss({ textEffect: 'shadow', backgroundColor: '#fde047' } as any, '#000'))
      .toBe('0 2px 4px rgba(0,0,0,0.45)');
    expect(textShadowCss({ textEffect: 'glow' }, '#111')).toContain('#ffffff');
    expect(textShadowCss({}, '#000')).toBeUndefined();
  });
  it('boxShadow toggle drives the box shadow, only with a background', async () => {
    const { textBoxShadowCss } = await import('./presentation');
    expect(textBoxShadowCss({ boxShadow: true, backgroundColor: '#fde047' }))
      .toBe('0 4px 14px rgba(0,0,0,0.28)');
    expect(textBoxShadowCss({ boxShadow: true })).toBeUndefined();       // no panel to shadow
    expect(textBoxShadowCss({ backgroundColor: '#fde047' })).toBeUndefined(); // toggle off
    expect(textBoxShadowCss({})).toBeUndefined();
  });
});

describe('textPaddingCss (per-side padding override)', () => {
  it('falls back to the preset default when unset', async () => {
    const { textPaddingCss } = await import('./presentation');
    expect(textPaddingCss({}, 'body')).toBe('8px 12px');
    expect(textPaddingCss({}, 'footnote')).toBe('0px 0px');
  });
  it('emits a per-side shorthand when padding is set', async () => {
    const { textPaddingCss } = await import('./presentation');
    expect(textPaddingCss({ padding: { top: 24, right: 40, bottom: 24, left: 40 } }, 'body'))
      .toBe('24px 40px 24px 40px');
    // override beats the preset, even footnote
    expect(textPaddingCss({ padding: { top: 10, right: 10, bottom: 10, left: 10 } }, 'footnote'))
      .toBe('10px 10px 10px 10px');
  });
});

describe('default insert positions snap to the 30px grid (the default spacing)', () => {
  it('every text preset default is grid-aligned (x/y/width/height % 30 === 0)', async () => {
    const { createTextElement } = await import('./presentation');
    for (const preset of ['title', 'body', 'textbox', 'annotation', 'footnote', 'hype'] as const) {
      const { x, y, width, height } = createTextElement(preset).position;
      expect({ preset, x: x % 30, y: y % 30, w: width % 30, h: height % 30 })
        .toEqual({ preset, x: 0, y: 0, w: 0, h: 0 });
    }
  });

  it('keeps a 60px (2-cell) outer margin: nothing runs into the slide edges', async () => {
    const { createTextElement } = await import('./presentation');
    for (const preset of ['title', 'body', 'footnote'] as const) {
      const { x, y, width, height } = createTextElement(preset).position;
      expect(x).toBeGreaterThanOrEqual(60);
      expect(y).toBeGreaterThanOrEqual(60);
      expect(x + width).toBeLessThanOrEqual(1920 - 60);
      expect(y + height).toBeLessThanOrEqual(1080 - 60);
    }
  });

  it('body starts flush at the title bottom (no gap between title and text)', async () => {
    const { createTextElement } = await import('./presentation');
    const title = createTextElement('title').position;
    const body = createTextElement('body').position;
    expect(body.y).toBe(title.y + title.height);
  });

  it('the footnote renders tight (no padding, single line-height) and fits its box', async () => {
    const { createTextElement, effectiveTextPresetSize, textPresetBoxCss } = await import('./presentation');
    const box = textPresetBoxCss('footnote');
    expect(box).toEqual({ lineHeight: 1, padY: 0, padX: 0 }); // tight per the user's call
    const { height } = createTextElement('footnote').position;
    const needed = effectiveTextPresetSize('footnote') * box.lineHeight + 2 * box.padY;
    expect(height).toBeGreaterThanOrEqual(needed);
  });

  it('only the footnote is tight; other presets keep the comfortable padding', async () => {
    const { textPresetBoxCss } = await import('./presentation');
    for (const preset of ['title', 'body', 'textbox', 'annotation', 'hype'] as const) {
      expect(textPresetBoxCss(preset)).toEqual({ lineHeight: 1.3, padY: 8, padX: 12 });
    }
  });
});
