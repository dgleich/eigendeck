import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PresentElement, type PresentCtx } from './PresentSlide';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

// @simplify-guard — render-snapshot net for PresentElement (the live present /
// projector renderer). Pins its DOM output for the static element types so the
// upcoming render-path dedup stays behavior-identical. Render-gate #3 (after
// exportCore HTML + SlideThumbnail DOM). Safe to prune once the unified renderer
// is trusted.
function ctx(): PresentCtx {
  const slide = { id: 's1', layout: 'default', notes: '', elements: [] } as unknown as Slide;
  const config = { width: 1920, height: 1080 } as unknown as Presentation['config'];
  return { slide, presentationConfig: config, presentationTheme: 'white' };
}
const els: SlideElement[] = [
  { id: 't1', type: 'text', preset: 'title', html: 'Title', position: { x: 60, y: 40, width: 800, height: 120 } },
  { id: 't2', type: 'text', preset: 'body', html: 'Body <b>x</b>', position: { x: 60, y: 200, width: 800, height: 200 } },
  { id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } },
  { id: 'c1', type: 'cover', color: '#222', position: { x: 1200, y: 500, width: 300, height: 200 } },
] as unknown as SlideElement[];

describe('[simplify-guard] PresentElement render snapshot', () => {
  it('renders the static element types to a stable DOM', () => {
    const c = ctx();
    const { container } = render(
      <>{els.map((el, i) => <PresentElement key={el.id} element={el} zIndex={i} ctx={c} />)}</>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});
