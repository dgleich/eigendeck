// A synced element links only to its own copies (docs/sync-and-link.md, "SQLite is
// the source of truth"), so the inspector offers no Unlink for it, and the slide's
// "Unlink All" leaves synced elements alone.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { usePresentationStore } from '../store/presentation';
import { PropertiesPanel } from './PropertiesPanel';
import { deriveSyncIds } from '../lib/syncLink';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

const el = (id: string, extra: Partial<SlideElement> = {}) =>
  ({ id, type: 'text', preset: 'body', html: id, position: { x: 0, y: 0, width: 100, height: 100 }, ...extra }) as SlideElement;
const sl = (id: string, elements: SlideElement[]) => ({ id, layout: 'default', notes: '', elements }) as unknown as Slide;

function seed(slides: Slide[], selected: { type: string; id?: string } | null) {
  usePresentationStore.setState({
    presentation: { title: 'T', theme: 'white', slides: deriveSyncIds(slides), config: { width: 1920, height: 1080 } } as unknown as Presentation,
    currentSlideIndex: 0,
    selectedObject: selected,
    inspectorTab: selected ? 'element' : 'slide',
  } as never);
}
const labels = (c: HTMLElement) => [...c.querySelectorAll('.prop-label')].map((l) => l.textContent);
const button = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

afterEach(cleanup);

describe('PropertiesPanel — Unlink on synced elements', () => {
  it('shows no Animated section (no Unlink) for a synced element', () => {
    seed([sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', [el('a', { linkId: 'L1' })])], { type: 'element', id: 'a' });
    const { container } = render(<PropertiesPanel />);
    expect(labels(container)).toContain('Synced');
    expect(labels(container)).not.toContain('Animated');
  });

  it('still offers Unlink for a linked element that is not synced', () => {
    seed([sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', [el('b', { linkId: 'L1' })])], { type: 'element', id: 'a' });
    const { container } = render(<PropertiesPanel />);
    expect(labels(container)).toContain('Animated');
  });

  it('Unlink All skips synced elements', () => {
    seed([
      sl('s0', [el('a', { linkId: 'L1' }), el('b', { linkId: 'L2' })]),
      sl('s1', [el('a', { linkId: 'L1' }), el('c', { linkId: 'L2' })]),
    ], null);
    const { container } = render(<PropertiesPanel />);
    button(container, 'Unlink All')!.click();
    const [s0] = usePresentationStore.getState().presentation.slides;
    expect(s0.elements.find((e) => e.id === 'a')!.linkId).toBe('L1');
    expect(s0.elements.find((e) => e.id === 'b')!.linkId).toBeUndefined();
  });
});
