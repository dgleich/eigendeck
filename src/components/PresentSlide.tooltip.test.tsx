// #203: while presenting, the cursor is a pointer. A `title` attribute on anything in
// the slide makes WebKit show a native tooltip on hover, covering what is being
// pointed at, so nothing the presenter renders may carry one.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PresentElement, PresentControllerIframe, type PresentCtx } from './PresentSlide';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

// Demo documents and the video embed shim load asynchronously from the backend;
// stub them so the iframes render in jsdom.
vi.mock('../lib/demoMount', async (orig) => ({
  ...(await orig<typeof import('../lib/demoMount')>()),
  useDemoDoc: () => 'about:blank',
  useDeckFontFacesCss: () => '',
}));
vi.mock('../lib/youtubeShim', async (orig) => ({
  ...(await orig<typeof import('../lib/youtubeShim')>()),
  useYoutubeShimBase: () => 'http://127.0.0.1:1',
  liveEmbedSrc: () => 'https://www.youtube.com/embed/x',
}));

function ctx(): PresentCtx {
  const slide = { id: 's1', layout: 'default', notes: '', elements: [] } as unknown as Slide;
  const config = { width: 1920, height: 1080 } as unknown as Presentation['config'];
  return { slide, presentationConfig: config, presentationTheme: 'white' };
}
const pos = { x: 100, y: 100, width: 400, height: 300 };
const elements = [
  { id: 'd1', type: 'demo', assetId: 'asset-demo', position: pos },
  { id: 'p1', type: 'demo-piece', assetId: 'asset-demo', piece: 'plot', position: pos },
  { id: 'h1', type: 'html', html: '<p>hi</p>', position: pos },
  { id: 'h2', type: 'html', html: '<p>hi</p>', interactive: true, position: pos },
  { id: 'v1', type: 'video', kind: 'embed', provider: 'youtube', url: 'https://youtu.be/x', position: pos },
] as unknown as SlideElement[];

describe('present mode shows no hover tooltips (#203)', () => {
  for (const el of elements) {
    it(`a ${el.type}${(el as { interactive?: boolean }).interactive ? ' (interactive)' : ''} element carries no title attribute`, () => {
      const { container } = render(<PresentElement element={el} zIndex={0} ctx={ctx()} />);
      expect(container.querySelector('iframe')).not.toBeNull();
      expect([...container.querySelectorAll('[title]')].map((n) => n.outerHTML.slice(0, 80))).toEqual([]);
    });
  }

  it('the hidden demo controller carries no title attribute', () => {
    const { container } = render(<PresentControllerIframe assetId="asset-demo" />);
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });
});
