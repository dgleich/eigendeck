import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SlideThumbnail } from './SlideThumbnail';
import type { Presentation, Slide } from '../types/presentation';

// @simplify-guard — render-snapshot net for SlideThumbnail (the static
// "C-renderer" shared by the sidebar thumbnails AND the speaker view). Pins its
// DOM output for the static element types so an upcoming render-path dedup stays
// behavior-identical. `width` is passed explicitly to skip the ResizeObserver
// path. Safe to prune once the unified renderer is trusted.
function deck(): { presentation: Presentation; slide: Slide } {
  const slide = {
    id: 's1', layout: 'default', notes: '',
    elements: [
      { id: 't1', type: 'text', preset: 'title', html: 'Title', position: { x: 60, y: 40, width: 800, height: 120 } },
      { id: 't2', type: 'text', preset: 'body', html: 'Body <b>x</b>', position: { x: 60, y: 200, width: 800, height: 200 } },
      { id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } },
      { id: 'c1', type: 'cover', color: '#222', position: { x: 1200, y: 500, width: 300, height: 200 } },
    ],
  } as unknown as Slide;
  const presentation = {
    title: 'T', theme: 'white',
    config: { width: 1920, height: 1080 },
    slides: [slide],
  } as unknown as Presentation;
  return { presentation, slide };
}

describe('[simplify-guard] SlideThumbnail render snapshot', () => {
  it('renders the static element types to a stable DOM', () => {
    const { presentation, slide } = deck();
    const { container } = render(
      <SlideThumbnail presentation={presentation} slide={slide} width={400} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('thumbnail html element (#137)', () => {
  it('renders a locked sandboxed iframe mini-preview', () => {
    const { presentation, slide } = deck();
    (slide.elements as unknown as Array<Record<string, unknown>>).push({
      id: 'h1', type: 'html', html: '<b>hi</b>',
      position: { x: 100, y: 100, width: 400, height: 300 },
    });
    const { container } = render(
      <SlideThumbnail presentation={presentation} slide={slide} width={400} />,
    );
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('srcdoc') || '').toContain('<b>hi</b>');
  });
});

describe('thumbnail curved arrow (#129)', () => {
  it('renders a curved arrow as an SVG <path>, not a <line>', () => {
    const { presentation, slide } = deck();
    (slide.elements as unknown as Array<Record<string, unknown>>).push({
      id: 'a2', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520,
      color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end',
      c1x: 200, c1y: 620, c2x: 300, c2y: 620,
      position: { x: 0, y: 0, width: 0, height: 0 },
    });
    const { container } = render(
      <SlideThumbnail presentation={presentation} slide={slide} width={400} />,
    );
    expect(container.innerHTML).toContain('<path d="M 100 500 C 200 620 300 620');
  });
});
