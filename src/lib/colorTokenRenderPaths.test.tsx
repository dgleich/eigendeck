import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TextElementSvg } from '../components/TextElementSvg';
import { describeArrow, describeCover } from './elementDescriptor.mjs';
import { coverHtml, arrowSvgHtml } from './elementHtml.mjs';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from './exportCore.mjs';
import { buildPrintSlideHtml } from './printSlideHtml';
import { textBackgroundResolved } from './textStyle.mjs';
import { resolveTheme } from './themes';
import type { Slide, Presentation, TextElement } from '../types/presentation';

// Guard for the LIVE theme-relative color token (#132 follow-up): a foreground
// `color: 'accent'` must resolve to the slide theme's accent in EVERY render path,
// and re-adapt when the theme changes (white accent #2563eb vs dark accent #60a5fa).
// Also pins the live cover fill tint (boxTint via describeCover) and arrow accent.
// A path that forgets resolveColor / passes no theme fails here.

const px = (n: number) => `${n}px`;
function deck(theme: string, el: TextElement): Presentation {
  return {
    title: 'T', theme,
    slides: [{ id: 's1', layout: 'default', notes: '', elements: [el] } as unknown as Slide],
    config: { width: 1920, height: 1080 },
  } as unknown as Presentation;
}
const accentText = () => ({ id: 't1', type: 'text', preset: 'body', html: 'hello', color: 'accent', position: { x: 0, y: 0, width: 400, height: 100 } } as unknown as TextElement);

const THEMES = ['white', 'dark'] as const; // white accent #2563eb, dark accent #60a5fa

describe("live 'accent' color token resolves per theme across paths", () => {
  for (const themeName of THEMES) {
    const theme = resolveTheme(themeName);
    const accent = theme.accent;

    describe(`theme=${themeName} (accent ${accent})`, () => {
      it('theme actually has a distinct accent', () => {
        expect(accent).toMatch(/^#[0-9a-f]{6}$/i);
      });

      // Text color — editor / present / thumbnail share TextElementSvg.
      it('text color=accent renders as the theme accent (TextElementSvg)', () => {
        const { container } = render(
          <TextElementSvg
            element={accentText()}
            slide={deck(themeName, accentText()).slides[0]}
            presentationTheme={themeName}
            presentationConfig={deck(themeName, accentText()).config}
          />,
        );
        expect(container.innerHTML).toContain(`color:${accent}`);
      });

      // HTML export (CLI/legacy branch → textElementHtml, resolves via resolveColor).
      it('text color=accent → HTML export carries the accent', async () => {
        const html = await buildExportHtml({
          presentation: deck(themeName, accentText()),
          readFile: async () => new Uint8Array([0]),
          readTextFile: async () => '',
          renderMath: null,
          applyMathPreamble: null,
        });
        expect(html).toContain(`color:${accent}`);
      });

      // PDF / print.
      it('text color=accent → print carries the accent', () => {
        const html = buildPrintSlideHtml(
          deck(themeName, accentText()).slides[0],
          deck(themeName, accentText()),
          new Map(),
          new Map(),
        );
        expect(html).toContain(`color:${accent}`);
      });

      // Arrow accent — describeArrow (5 render callers) + the export builder.
      it('arrow color=accent resolves to the theme accent', () => {
        const arrow = { x1: 0, y1: 0, x2: 10, y2: 0, color: 'accent' };
        expect(describeArrow(arrow, theme).color).toBe(accent);
        expect(arrowSvgHtml(arrow, { theme })).toContain(accent);
      });

      // Cover fill tint — describeCover resolves boxTint against the theme.
      it('cover boxTint=accent fills with the resolved theme wash', () => {
        const cover = { position: { x: 0, y: 0, width: 10, height: 10 }, boxTint: 'accent' };
        const want = textBackgroundResolved({ boxTint: 'accent' }, theme)!;
        expect(describeCover(cover, theme.background, theme).background).toBe(want);
        expect(coverHtml(cover, theme.background, px, theme)).toContain(want);
      });
    });
  }
});
