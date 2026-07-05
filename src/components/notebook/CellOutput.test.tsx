import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CellOutput } from './CellOutput';
import type { CellOutput as CellOutputT } from '../../lib/notebookFormat';

const displayData = (data: Record<string, string | string[]>): CellOutputT =>
  ({ kind: 'display_data', data });

describe('CellOutput security routing (docs/NOTEBOOK-ISOLATION.md)', () => {
  it('static text/html (pandas table) renders inline, sanitized', async () => {
    const { container } = render(
      <CellOutput output={displayData({ 'text/html': '<table class="df"><tr><td>ok</td></tr></table>' })} />,
    );
    // static output is routed inline (a div, not an iframe)
    const div = container.querySelector('div.nb-html')!;
    expect(div).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    await waitFor(() => expect(div.innerHTML).toContain('<td>ok</td>'));
  });

  it('static-looking output that smuggles a <script> is contained in an iframe, not inlined', () => {
    const { container } = render(
      <CellOutput output={displayData({ 'text/html': '<table><tr><td>ok</td></tr></table><script>evil()</script>' })} />,
    );
    // executable content anywhere → iframe (contained), never inline
    expect(container.querySelector('iframe.el-demo-frame')).toBeTruthy();
    expect(container.querySelector('div.nb-html')).toBeNull();
  });

  it('executable text/html (Plotly-style) routes to a sandboxed iframe', () => {
    const { container } = render(
      <CellOutput output={displayData({ 'text/html': '<div id="p"></div><script>Plotly.newPlot("p",[])</script>' })} />,
    );
    const iframe = container.querySelector('iframe.el-demo-frame') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    // opaque origin: allow-scripts only, never allow-same-origin
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('svg output is sanitized inline', async () => {
    const { container } = render(
      <CellOutput output={displayData({ 'image/svg+xml': '<svg><script>evil()</script><rect width="1" height="1"/></svg>' })} />,
    );
    const div = container.querySelector('div.nb-image')!;
    await waitFor(() => expect(div.innerHTML.toLowerCase()).toContain('<rect'));
    expect(div.innerHTML.toLowerCase()).not.toContain('<script');
    expect(div.innerHTML).not.toContain('evil');
  });

  it('png output is a plain data-url image (unchanged)', () => {
    const { container } = render(
      <CellOutput output={displayData({ 'image/png': 'AAAA' })} />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
});
