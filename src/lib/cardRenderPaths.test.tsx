import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TextElementSvg } from '../components/TextElementSvg';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from './exportCore.mjs';
import { buildPrintSlideHtml } from './printSlideHtml';
import { textBackgroundResolved, textBoxShadowCss } from './textStyle.mjs';
import { resolveTheme } from './themes';
import type { Slide, Presentation, TextElement } from '../types/presentation';

// The "Card" (#132) is a Beamer-block-style titled box: a themed FILL on the
// ordinary text element (boxTint + borderRadius + boxShadow). It has NO dedicated
// element type — it rides `text` through all render paths. The thing most likely
// to silently drift is the THEMED TINT: it's resolved relative to the slide theme
// (light themes wash to a pastel, dark themes lift to an elevated surface), and it
// is wired BY HAND into every path (the classic 7-path straggler trap). This test
// pins that the resolved tint + rounded corner + shadow reach the OUTPUT of every
// path, on a light theme (white → pastel branch) AND a dark theme (dark → lift
// branch). A path that drops boxTint, or hard-codes a fixed color, fails here.

function card(): TextElement {
  return {
    id: 'card1',
    type: 'text',
    preset: 'body',
    html: '<div>TITLE</div><div>Card contents</div>',
    boxTint: 'accent',
    borderRadius: 30,
    boxShadow: true,
    position: { x: 660, y: 410, width: 600, height: 260 },
  } as TextElement;
}

function deck(theme: string): Presentation {
  return {
    title: 'Card Test',
    theme,
    slides: [{ id: 's1', layout: 'default', notes: '', elements: [card()] } as unknown as Slide],
    config: { width: 1920, height: 1080 },
  } as unknown as Presentation;
}

/** jsdom serializes an inline `backgroundColor` hex as `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

// white → light (pastel) tint branch; dark → dark (lift) tint branch.
const THEMES = ['white', 'dark'] as const;

describe('Card (#132) renders across all render paths', () => {
  for (const themeName of THEMES) {
    const theme = resolveTheme(themeName);
    const expectTint = textBackgroundResolved(card(), theme)!; // source of truth
    const expectShadow = textBoxShadowCss(card());

    describe(`theme=${themeName}`, () => {
      it('the resolved tint is a real color distinct from the base + white', () => {
        expect(expectTint).toMatch(/^#[0-9a-f]{6}$/i);
        expect(expectTint).not.toBe(theme.background); // it actually tinted
        expect(expectTint.toLowerCase()).not.toBe('#ffffff'); // not washed out
        expect(expectShadow).toBeTruthy();
      });

      // Paths #1 editor, #2 present/projector, #7 sidebar thumbnail all converge
      // on the TextElementSvg wrapper — one render guards all three.
      it('editor / present / thumbnail (TextElementSvg wrapper)', () => {
        const { container } = render(
          <TextElementSvg
            element={card()}
            slide={deck(themeName).slides[0]}
            presentationTheme={themeName}
            presentationConfig={deck(themeName).config}
          />,
        );
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.style.backgroundColor.toLowerCase()).toBe(hexToRgb(expectTint).toLowerCase());
        expect(wrapper.style.borderRadius).toBe('30px');
        expect(wrapper.style.boxShadow).toBeTruthy();
      });

      // Path #4 HTML export, app/GUI caller: math pre-rendered to SVG, wrapper div
      // adds the box fill.
      it('HTML export — app branch (pre-rendered SVG wrapper)', async () => {
        const html = await buildExportHtml({
          presentation: deck(themeName),
          renderTextElement: async () => '<svg>stub</svg>',
          readFile: async () => new Uint8Array([0]),
          readTextFile: async () => '',
          renderMath: null,
          applyMathPreamble: null,
        });
        expect(html).toContain(`background:${expectTint}`);
        expect(html).toContain('border-radius:30px');
        expect(html).toContain('box-shadow:');
      });

      // Path #4 HTML export, headless CLI caller: no renderTextElement callback →
      // legacy textElementHtml branch. Wired separately (the #85 bug class).
      it('HTML export — CLI/legacy branch (textElementHtml)', async () => {
        const html = await buildExportHtml({
          presentation: deck(themeName),
          readFile: async () => new Uint8Array([0]),
          readTextFile: async () => '',
          renderMath: null,
          applyMathPreamble: null,
        });
        expect(html).toContain(`background:${expectTint}`);
        expect(html).toContain('border-radius:');
        expect(html).toContain('box-shadow:');
      });

      // Path #5 PDF / "Export for Print": same textElementHtml, inch/point units.
      it('PDF / print export (buildPrintSlideHtml)', () => {
        const html = buildPrintSlideHtml(
          deck(themeName).slides[0],
          deck(themeName),
          new Map(),
          new Map(),
        );
        expect(html).toContain(`background:${expectTint}`);
        expect(html).toContain('border-radius:');
        expect(html).toContain('box-shadow:');
      });
    });
  }
});
