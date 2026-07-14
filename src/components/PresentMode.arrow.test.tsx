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

  it('honors interior waypoints so a curved-with-points arrow keeps its shape (A1)', () => {
    // A curved arrow with an interior waypoint. Without passing points to the
    // geometry, the path would be a plain 2-handle cubic ignoring the waypoint.
    const to = arrow({ x1: 0, y1: 0, x2: 400, y2: 0, c1x: 40, c1y: 0, c2x: 360, c2y: 0,
      points: [{ x: 200, y: 200 }] });
    const withPts = render(<AnimatedArrow from={to} to={to} zIndex={0} animating={false} hasPrev={false} />).container.innerHTML;
    const noPts = render(<AnimatedArrow from={arrow({ x1: 0, y1: 0, x2: 400, y2: 0, c1x: 40, c1y: 0, c2x: 360, c2y: 0 })}
      to={arrow({ x1: 0, y1: 0, x2: 400, y2: 0, c1x: 40, c1y: 0, c2x: 360, c2y: 0 })}
      zIndex={0} animating={false} hasPrev={false} />).container.innerHTML;
    // The waypoint bends the path, so the two path strings must differ.
    expect(withPts).not.toEqual(noPts);
    expect(withPts).toContain('200'); // the waypoint coordinate shows up in the path
  });

  it('resolves the accent color token against the theme (A2)', () => {
    const to = arrow({ color: 'accent', x1: 0, y1: 0, x2: 300, y2: 0 });
    const theme = { background: '#000', accent: '#ff8800', text: '#fff' } as any;
    const { container } = render(
      <AnimatedArrow from={to} to={to} zIndex={0} animating={false} hasPrev={false} theme={theme} />,
    );
    const line = container.querySelector('line')!;
    expect(line.getAttribute('stroke')).toBe('#ff8800'); // NOT the literal "accent" / default red
  });

  it('defaults an uncolored arrow to #2563eb, matching every other path (A2)', () => {
    const to = arrow({ color: undefined, x1: 0, y1: 0, x2: 300, y2: 0 });
    const { container } = render(<AnimatedArrow from={to} to={to} zIndex={0} animating={false} hasPrev={false} />);
    expect(container.querySelector('line')!.getAttribute('stroke')).toBe('#2563eb');
  });
});
