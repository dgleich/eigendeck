// #86 — demo theme inheritance. Pure-layer tests (no rig): the CSS the demo
// iframe receives. The WebKit end-to-end matrix (10 fonts × 4 themes, font
// faces actually loading) is e2e/demo-theme-scenario.mjs.
import { describe, it, expect } from 'vitest';
import {
  demoThemeVarsCss, injectDemoThemeIntoHtml, DEMO_VARS_STYLE_ID,
} from './demoTheme.mjs';
import { demoVarsCssForSlide } from './demoThemeInject';
import { BUILT_IN_THEMES } from './themes';

const COLORS = { background: '#000000', text: '#ffffff', heading: '#f0f0f0', accent: '#93c5fd', muted: '#9ca3af' };

describe('demoThemeVarsCss', () => {
  it('emits all five color vars', () => {
    const css = demoThemeVarsCss(COLORS, {});
    expect(css).toContain('--eigendeck-bg: #000000;');
    expect(css).toContain('--eigendeck-fg: #ffffff;');
    expect(css).toContain('--eigendeck-heading: #f0f0f0;');
    expect(css).toContain('--eigendeck-accent: #93c5fd;');
    expect(css).toContain('--eigendeck-muted: #9ca3af;');
  });

  it('emits font vars when provided and omits them when absent', () => {
    const full = demoThemeVarsCss(COLORS, { font: 'PT Sans', narrow: 'PT Sans Narrow', mono: 'Source Code Pro', baseSize: 48 });
    expect(full).toContain("--eigendeck-font: 'PT Sans';");
    expect(full).toContain("--eigendeck-narrow: 'PT Sans Narrow';");
    expect(full).toContain("--eigendeck-mono: 'Source Code Pro';");
    expect(full).toContain('--eigendeck-base-size: 48px;');

    const bare = demoThemeVarsCss(COLORS, {});
    expect(bare).not.toContain('--eigendeck-font');
    expect(bare).not.toContain('--eigendeck-narrow');
    expect(bare).not.toContain('--eigendeck-base-size');
  });
});

describe('injectDemoThemeIntoHtml', () => {
  it('splices a style (fonts + vars) right after <head>, before <body>', () => {
    const out = injectDemoThemeIntoHtml(
      '<html><head><title>x</title></head><body>hi</body></html>',
      '@font-face{font-family:X;src:url(/fonts/x.ttf)}',
      ':root{--eigendeck-bg: #fff;}',
    );
    expect(out).toContain(`id="${DEMO_VARS_STYLE_ID}"`);
    expect(out).toContain('@font-face{font-family:X');
    expect(out).toContain('--eigendeck-bg: #fff;');
    expect(out.indexOf('<head>')).toBeLessThan(out.indexOf(DEMO_VARS_STYLE_ID));
    expect(out.indexOf(DEMO_VARS_STYLE_ID)).toBeLessThan(out.indexOf('<body>'));
  });

  it('prepends the style when there is no <head>', () => {
    const out = injectDemoThemeIntoHtml('<div>x</div>', '', ':root{--eigendeck-bg: #fff;}');
    expect(out.startsWith('<style')).toBe(true);
    expect(out).toContain('<div>x</div>');
  });

  it('is a no-op when both css blocks are empty', () => {
    expect(injectDemoThemeIntoHtml('<p>x</p>', '', '')).toBe('<p>x</p>');
  });
});

describe('demoVarsCssForSlide — every built-in theme maps to its resolved colors', () => {
  for (const [name, def] of Object.entries(BUILT_IN_THEMES)) {
    it(`theme "${name}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const css = demoVarsCssForSlide({} as any, name, { id: 's', elements: [] } as any);
      expect(css).toContain(`--eigendeck-bg: ${def.colors.background};`);
      expect(css).toContain(`--eigendeck-fg: ${def.colors.text};`);
      expect(css).toContain(`--eigendeck-heading: ${def.colors.heading};`);
      expect(css).toContain(`--eigendeck-accent: ${def.colors.accent};`);
      expect(css).toContain(`--eigendeck-muted: ${def.colors.muted};`);
      // default body font resolves to Lato (DEFAULT_FONT_ID)
      expect(css).toContain("--eigendeck-font: 'Lato';");
    });
  }
});

describe('demoVarsCssForSlide — narrow falls back to the body font (only PT Sans has a real narrow)', () => {
  it('PT Sans → PT Sans Narrow', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const css = demoVarsCssForSlide({} as any, 'white', { id: 's', elements: [], bodyFont: 'ptsans' } as any);
    expect(css).toContain("--eigendeck-narrow: 'PT Sans Narrow';");
  });
  it('a font without a narrow variant → its own family, not PT Sans Narrow', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const css = demoVarsCssForSlide({} as any, 'white', { id: 's', elements: [], bodyFont: 'libertinus' } as any);
    expect(css).toContain("--eigendeck-narrow: 'Libertinus Serif';");
    expect(css).not.toContain('PT Sans Narrow');
  });
});
