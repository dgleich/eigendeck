import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { LinkOverlay } from './LinkOverlay';
import { usePresentationStore } from '../store/presentation';
import type { Presentation } from '../types/presentation';

// @simplify-guard — render-snapshot net for LinkOverlay (the link-target picker,
// render-path gate #5). Pins the per-type click-target markup before that switch
// is migrated onto the unified element-descriptor path, so the move stays
// behavior-identical. Static types only (video/notebook pull async preview
// components, like the other render-path snapshots). ResizeObserver is stubbed
// so slideScale stays at its 0.5 default → stable transform. Safe to prune once
// the unified renderer is trusted.
beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
});

function seedDeck() {
  // Slide 0 holds the link SOURCE (a text element); slide 1 is the view slide
  // whose elements become the click targets. viewIndex defaults to slide 1.
  const source = { id: 'src', type: 'text', preset: 'body', html: 'src', position: { x: 0, y: 0, width: 100, height: 50 } };
  const targets = [
    { id: 't1', type: 'text', preset: 'title', html: 'Title', position: { x: 60, y: 40, width: 800, height: 120 } },
    { id: 'i1', type: 'image', src: 'a.png', position: { x: 60, y: 200, width: 300, height: 200 } },
    { id: 'd1', type: 'demo', src: 'd.html', position: { x: 400, y: 200, width: 300, height: 200 } },
    { id: 'p1', type: 'demo-piece', piece: 'fig', demoSrc: 'd.html', position: { x: 800, y: 200, width: 200, height: 200 } },
    { id: 'c1', type: 'cover', color: '#222', position: { x: 1200, y: 500, width: 300, height: 200 } },
    { id: 'a1', type: 'arrow', x1: 100, y1: 500, x2: 400, y2: 520, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } },
  ];
  const presentation = {
    title: 'T', theme: 'white', config: { width: 1920, height: 1080 },
    slides: [
      { id: 's0', layout: 'default', notes: '', elements: [source] },
      { id: 's1', layout: 'default', notes: '', elements: targets },
    ],
  } as unknown as Presentation;
  usePresentationStore.setState({ presentation, currentSlideIndex: 0 });
}

describe('[simplify-guard] LinkOverlay render snapshot', () => {
  it('renders the static link-target types to a stable DOM', () => {
    seedDeck();
    const { container } = render(<LinkOverlay elementId="src" onClose={() => {}} />);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
