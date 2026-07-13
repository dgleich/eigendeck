// Guards the print stale-preview fix: the notebook preview (baked into the PDF/
// print export as a raster screenshot) must re-capture when the deck THEME
// changes. The theme is applied as CSS vars on .nb-frame, so a theme switch does
// not change `element`; without threading the theme into capturePreview's salt +
// backdrop, print served a STALE (old-theme) preview — dark cell output wrong on a
// black slide, while live/present/HTML-export rendered fresh. The dedup mechanism
// (salt/background change → re-capture) is covered by previewCache.test.ts; this
// asserts NotebookContent actually PASSES the theme through.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { resolveTheme } from '../../lib/themes';

const { capturePreview } = vi.hoisted(() => ({ capturePreview: vi.fn((..._args: any[]) => Promise.resolve()) }));
vi.mock('../../lib/previewCache', async (orig) => ({ ...(await orig()), capturePreview }));
vi.mock('../../lib/useNotebook', () => ({
  useNotebook: () => ({ notebook: { cells: [], language: 'python', kernelDisplayName: 'Python 3', kernelspecName: 'python3' }, loading: false, error: null }),
}));
// Take the shallow "lite" render path so we exercise the NotebookContent-level
// capture effect without the full external-kernel/overlay tree.
vi.mock('../../lib/notebookKernel', async (orig) => ({ ...(await orig()), resolveNotebookKernel: () => ({ kind: 'lite' }) }));
vi.mock('../../lib/preferences', () => ({ usePreference: () => [[], () => {}] }));

import { NotebookContent } from './NotebookContent';
import { usePresentationStore } from '../../store/presentation';

const el = { id: 'nb1', type: 'notebook', assetId: 'a', position: { x: 0, y: 0, width: 400, height: 300 } } as any;

function setTheme(theme: string) {
  usePresentationStore.setState({
    presentation: { title: 'T', theme, slides: [{ id: 's1', elements: [el], notes: '' }], config: { width: 1920, height: 1080 } },
    currentSlideIndex: 0,
  } as any);
}

describe('NotebookContent preview capture is theme-aware (print stale-preview fix)', () => {
  beforeEach(() => { capturePreview.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('passes the theme background as capturePreview salt + backdrop', () => {
    setTheme('black');
    render(<NotebookContent element={el} interactive={false} mode="editor" />);
    vi.advanceTimersByTime(700);
    const blackBg = resolveTheme('black', undefined).background;
    expect(capturePreview).toHaveBeenCalled();
    const call = capturePreview.mock.calls[capturePreview.mock.calls.length - 1];
    expect(call[1]).toBe('.nb-frame');       // target
    expect(call[2]).toContain(blackBg);      // theme is in the dedup salt
    expect(call[3]).toBe(blackBg);           // theme background is the rasterizer backdrop
  });

  it('a different theme yields a different salt → busts the dedup, re-captures', () => {
    setTheme('white');
    const { rerender } = render(<NotebookContent element={el} interactive={false} mode="editor" />);
    vi.advanceTimersByTime(700);
    const whiteSalt = capturePreview.mock.calls[capturePreview.mock.calls.length - 1][2];
    capturePreview.mockClear();
    setTheme('black');
    rerender(<NotebookContent element={el} interactive={false} mode="editor" />);
    vi.advanceTimersByTime(700);
    const blackSalt = capturePreview.mock.calls[capturePreview.mock.calls.length - 1][2];
    expect(blackSalt).not.toBe(whiteSalt);
  });
});
