// CHARACTERIZATION NET for every color control in the inspector (PropertiesPanel:
// text color, text background+tint, arrow color, cover color). Pins the EXACT
// field payload each affordance writes AND the exact palette offered (by clicking
// every swatch and recording what it writes). This locks current behavior so the
// upcoming <ColorControl> unification can be proven output-identical: these
// assertions must stay green through the refactor. The inline text-format toolbar
// (execCommand-based, path A) is characterized in TextFormatToolbar.test.tsx.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { usePresentationStore } from '../store/presentation';
import { PropertiesPanel } from './PropertiesPanel';
import type { Presentation, SlideElement } from '../types/presentation';

function deckWith(el: SlideElement, opts: { theme?: string; customPalette?: string[] } = {}): Presentation {
  return {
    title: 'T', theme: opts.theme ?? 'white',
    slides: [{ id: 's1', layout: 'default', notes: '', elements: [el] } as unknown as Presentation['slides'][0]],
    config: { width: 1920, height: 1080, ...(opts.customPalette ? { customPalette: opts.customPalette } : {}) },
  } as unknown as Presentation;
}
function seed(el: SlideElement, opts: { theme?: string; customPalette?: string[] } = {}) {
  usePresentationStore.setState({
    presentation: deckWith(el, opts),
    currentSlideIndex: 0,
    selectedObject: { type: 'element', id: el.id },
    inspectorTab: 'element',
  } as never);
}
const curEl = () => usePresentationStore.getState().presentation.slides[0].elements[0] as unknown as Record<string, unknown>;

/** The .prop-section whose .prop-label matches `label`. */
function section(container: HTMLElement, label: string): HTMLElement {
  const s = [...container.querySelectorAll('.prop-section')].find(
    (el) => el.querySelector('.prop-label')?.textContent === label,
  );
  if (!s) throw new Error(`no PropSection labelled "${label}"`);
  return s as HTMLElement;
}
const chip = (scope: HTMLElement, text: string): HTMLButtonElement => {
  const b = [...scope.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
};
const swatches = (scope: HTMLElement) => [...scope.querySelectorAll('button.prop-color-swatch')] as HTMLButtonElement[];
const colorInput = (scope: HTMLElement) => scope.querySelector('input[type="color"]') as HTMLInputElement;

/** Click each fixed swatch in a section and record what `field` it writes — pins
 *  the palette VALUES and the write in one shot. Re-queries after each click
 *  (the panel re-renders). Skips the leading tint swatches when `skip` is set. */
function paletteWrites(container: HTMLElement, label: string, field: string, skip = 0): string[] {
  const n = swatches(section(container, label)).length;
  const out: string[] = [];
  for (let i = skip; i < n; i++) {
    swatches(section(container, label))[i].click();
    out.push(String(curEl()[field]));
  }
  return out;
}

const TEXT = () => ({ id: 'e1', type: 'text', preset: 'body', html: 'x', position: { x: 0, y: 0, width: 100, height: 100 } } as unknown as SlideElement);
const ARROW = () => ({ id: 'e1', type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, color: '#111111', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } } as unknown as SlideElement);
const COVER = () => ({ id: 'e1', type: 'cover', color: '#111111', position: { x: 0, y: 0, width: 100, height: 100 } } as unknown as SlideElement);

beforeEach(() => cleanup());

describe('[characterize] Text Color (element.color)', () => {
  it('"Auto" clears color; palette + custom write color', () => {
    seed({ ...TEXT(), color: '#123456' } as SlideElement);
    const { container } = render(<PropertiesPanel />);
    const sec = section(container, 'Text Color');
    chip(sec, 'Auto').click();
    expect(curEl().color).toBeUndefined();
    // custom hex input
    const inp = colorInput(sec);
    fireEvent.change(inp, { target: { value: '#abcdef' } });
    expect(curEl().color).toBe('#abcdef');
  });

  it('offers exactly TEXT_COLORS, each writing element.color', () => {
    seed(TEXT());
    const { container } = render(<PropertiesPanel />);
    expect(paletteWrites(container, 'Text Color', 'color')).toEqual([
      '#1a1a1a', '#6b7280', '#9ca3af', '#ffffff',
      '#dc2626', '#ea580c', '#16a34a', '#0d9488',
      '#2563eb', '#9333ea',
    ]);
  });

  it('shows deck customPalette swatches first (writing color)', () => {
    seed(TEXT(), { customPalette: ['#ff00ff'] });
    const { container } = render(<PropertiesPanel />);
    const first = swatches(section(container, 'Text Color'))[0];
    first.click();
    expect(curEl().color).toBe('#ff00ff');
  });
});

describe('[characterize] Text Background (backgroundColor xor boxTint)', () => {
  it('"None" clears backgroundColor, boxTint, backgroundOpacity, boxShadow', () => {
    seed({ ...TEXT(), backgroundColor: '#eeeeee', backgroundOpacity: 0.5, boxShadow: true } as SlideElement);
    const { container } = render(<PropertiesPanel />);
    chip(section(container, 'Background'), 'None').click();
    const el = curEl();
    expect(el.backgroundColor).toBeUndefined();
    expect(el.boxTint).toBeUndefined();
    expect(el.backgroundOpacity).toBeUndefined();
    expect(el.boxShadow).toBeUndefined();
  });

  it('tint swatches set boxTint + clear backgroundColor/opacity (exact bases)', () => {
    const bases: string[] = [];
    for (const title of [
      'Theme accent tint (adapts to each slide theme)',
      'Red tint (alert)', 'Green tint (example)', 'Amber tint', 'Purple tint',
    ]) {
      seed({ ...TEXT(), backgroundColor: '#eeeeee', backgroundOpacity: 0.5 } as SlideElement);
      const { container } = render(<PropertiesPanel />);
      const b = [...section(container, 'Background').querySelectorAll('button.prop-color-swatch')]
        .find((x) => x.getAttribute('title') === title) as HTMLButtonElement;
      b.click();
      const el = curEl();
      bases.push(String(el.boxTint));
      expect(el.backgroundColor).toBeUndefined();
      expect(el.backgroundOpacity).toBeUndefined();
      cleanup();
    }
    expect(bases).toEqual(['accent', '#dc2626', '#16a34a', '#d97706', '#7c3aed']);
  });

  it('fixed swatches set backgroundColor + clear boxTint (exact TEXT_BG_COLORS)', () => {
    seed(TEXT());
    const { container } = render(<PropertiesPanel />);
    // First 5 swatches are the tints; the rest are TEXT_BG_COLORS.
    expect(paletteWrites(container, 'Background', 'backgroundColor', 5)).toEqual([
      '#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af', '#374151', '#000000',
      '#fee2e2', '#ffedd5', '#fef9c3', '#fff3b0', '#dcfce7', '#ccfbf1',
      '#fca5a5', '#fdba74', '#fde047', '#86efac', '#5eead4', '#7dd3fc',
      '#93c5fd', '#a5b4fc', '#c4b5fd', '#f0abfc', '#f9a8d4',
      '#b91c1c', '#15803d', '#1d4ed8', '#6d28d9',
    ]);
    expect(curEl().boxTint).toBeUndefined();
  });

  it('custom hex sets backgroundColor + clears boxTint', () => {
    seed({ ...TEXT(), boxTint: 'accent' } as SlideElement);
    const { container } = render(<PropertiesPanel />);
    const inp = colorInput(section(container, 'Background'));
    fireEvent.change(inp, { target: { value: '#abcdef' } });
    expect(curEl().backgroundColor).toBe('#abcdef');
    expect(curEl().boxTint).toBeUndefined();
  });
});

describe('[characterize] Arrow Color (element.color)', () => {
  it('offers exactly ARROW_COLORS, each writing element.color', () => {
    seed(ARROW());
    const { container } = render(<PropertiesPanel />);
    expect(paletteWrites(container, 'Color', 'color')).toEqual([
      '#e53e3e', '#dc2626', '#ea580c', '#16a34a',
      '#2563eb', '#9333ea', '#222222', '#6b7280',
    ]);
  });
});

describe('[characterize] Cover Color (element.color)', () => {
  it('"Match" clears color; custom writes color', () => {
    seed({ ...COVER(), color: '#123456' } as SlideElement);
    const { container } = render(<PropertiesPanel />);
    const sec = section(container, 'Color');
    chip(sec, 'Match').click();
    expect(curEl().color).toBeUndefined();
    const inp = colorInput(sec);
    fireEvent.change(inp, { target: { value: '#abcdef' } });
    expect(curEl().color).toBe('#abcdef');
  });

  it('offers exactly TEXT_BG_COLORS (reused), each writing element.color', () => {
    seed(COVER());
    const { container } = render(<PropertiesPanel />);
    expect(paletteWrites(container, 'Color', 'color')).toEqual([
      '#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af', '#374151', '#000000',
      '#fee2e2', '#ffedd5', '#fef9c3', '#fff3b0', '#dcfce7', '#ccfbf1',
      '#fca5a5', '#fdba74', '#fde047', '#86efac', '#5eead4', '#7dd3fc',
      '#93c5fd', '#a5b4fc', '#c4b5fd', '#f0abfc', '#f9a8d4',
      '#b91c1c', '#15803d', '#1d4ed8', '#6d28d9',
    ]);
  });
});
