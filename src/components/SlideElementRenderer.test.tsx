import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SlideElementRenderer } from './SlideElementRenderer';
import type { SlideElement } from '../types/presentation';

// @simplify-guard — render-snapshot net for SlideElementRenderer (the EDITOR
// canvas renderer — render-path gate #4, after exportCore + SlideThumbnail +
// PresentSlide). Pins its DOM for the static element types so an upcoming
// editor-path dedup stays behavior-identical. Stub callbacks; static types only
// (demo/video/notebook render live iframes). Safe to prune once the unified
// renderer is trusted.
const noop = () => {};
function renderEl(el: SlideElement) {
  return render(
    <SlideElementRenderer
      element={el} zIndex={1} scale={0.5} projectPath={null} isSelected={false}
      slideBackground="#ffffff" onUpdate={noop} onDelete={noop} onSelect={noop}
    />,
  ).container.innerHTML;
}
const els: Record<string, SlideElement> = {
  title: { id: 't1', type: 'text', preset: 'title', html: 'Title', position: { x: 60, y: 40, width: 800, height: 120 } } as unknown as SlideElement,
  body: { id: 't2', type: 'text', preset: 'body', html: 'Body <b>x</b>', position: { x: 60, y: 200, width: 800, height: 200 } } as unknown as SlideElement,
  arrow: { id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } } as unknown as SlideElement,
  cover: { id: 'c1', type: 'cover', color: '#222', position: { x: 1200, y: 500, width: 300, height: 200 } } as unknown as SlideElement,
};

describe('[simplify-guard] SlideElementRenderer render snapshot', () => {
  for (const [name, el] of Object.entries(els)) {
    it(`renders ${name} to a stable DOM`, () => {
      expect(renderEl(el)).toMatchSnapshot();
    });
  }
});

describe('curved arrow (#129)', () => {
  const curved = { id: 'a2', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520,
    color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end',
    c1x: 200, c1y: 620, c2x: 300, c2y: 620,
    position: { x: 0, y: 0, width: 0, height: 0 } } as unknown as SlideElement;

  it('renders the curved arrow as an SVG <path>, not a <line>', () => {
    const html = renderEl(curved);
    expect(html).toContain('<path d="M 100 500 C 200 620 300 620');
    // The visible glyph is a path; the only <line> would be the (straight) fat
    // hit target, which for a curve is also replaced by a path.
    expect(html).not.toContain('<line');
  });
});
