import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnimatedArrow, effControls } from './PresentMode';
import type { SlideElement } from '../types/presentation';

// Render-path gate #3 (present-mode wrapper) for curved arrows (#129): the linked
// arrow animator interpolates control points and renders the tween as an SVG path.
type ArrowEl = Extract<SlideElement, { type: 'arrow' }>;
const arrow = (o: Partial<ArrowEl>): ArrowEl => ({
  id: 'a', type: 'arrow', x1: 0, y1: 0, x2: 300, y2: 0,
  color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end',
  position: { x: 0, y: 0, width: 0, height: 0 }, ...o,
} as ArrowEl);

describe('effControls (#129)', () => {
  it('returns the arrow’s own control points when present', () => {
    expect(effControls(arrow({ c1x: 10, c1y: 20, c2x: 30, c2y: 40 })))
      .toEqual({ c1x: 10, c1y: 20, c2x: 30, c2y: 40 });
  });
  it('falls back to the 1/3 & 2/3 chord points when absent (so straight↔curved tweens smoothly)', () => {
    // chord (0,0)→(300,0): thirds at x=100 and x=200, both on the line (y=0).
    expect(effControls(arrow({}))).toEqual({ c1x: 100, c1y: 0, c2x: 200, c2y: 0 });
  });
});

describe('AnimatedArrow curved render (#129)', () => {
  it('renders a curved target arrow as an SVG <path> (not animating)', () => {
    // animating=false → the effect snaps coords to `to` synchronously; a curved
    // `to` renders a <path>, exercising the present-mode wrapper render branch.
    const to = arrow({ x1: 100, y1: 500, x2: 400, y2: 520, c1x: 200, c1y: 620, c2x: 300, c2y: 620 });
    const { container } = render(<AnimatedArrow from={to} to={to} zIndex={0} animating={false} hasPrev={false} />);
    expect(container.innerHTML).toContain('<path d="M 100 500 C 200 620 300 620');
    expect(container.querySelector('line')).toBeNull();
  });

  it('renders a straight target arrow as a <line>', () => {
    const to = arrow({ x1: 100, y1: 500, x2: 400, y2: 520 });
    const { container } = render(<AnimatedArrow from={to} to={to} zIndex={0} animating={false} hasPrev={false} />);
    expect(container.querySelector('line')).not.toBeNull();
    expect(container.querySelector('path')).toBeNull();
  });
});
