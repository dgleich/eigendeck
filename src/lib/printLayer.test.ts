import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock every boundary the module reaches, so we exercise its own logic ----

// Store: only used by the liveCapture flip-through path.
const selectObject = vi.fn();
const selectSlide = vi.fn();
vi.mock('../store/presentation', () => ({
  usePresentationStore: {
    getState: vi.fn(() => ({ currentSlideIndex: 0, selectObject, selectSlide })),
  },
}));

// buildPrintSlideHtml: capture the args it is handed so we can assert what data
// flowed into the print realization, and return a marker string.
const buildCalls: unknown[][] = [];
vi.mock('./printSlideHtml', () => ({
  buildPrintSlideHtml: vi.fn((...args: unknown[]) => {
    buildCalls.push(args);
    const slide = args[0] as { id: string };
    const n = args[5] as number;
    return `SLIDE#${n}:${slide.id}`;
  }),
}));

vi.mock('./previewCache', () => ({
  previewKey: vi.fn((el: { id: string }) => `pk:${el.id}`),
  loadPreviewDataUrl: vi.fn(async () => null),
  isPreviewThemeStale: vi.fn(async () => false),
}));

vi.mock('./themes', () => ({
  resolveTheme: vi.fn(() => ({ name: 'resolved' })),
  previewThemeSalt: vi.fn(() => 'salt'),
}));

vi.mock('./base64', () => ({
  bytesToBase64: vi.fn(() => 'B64'),
}));

vi.mock('./fonts', () => ({
  fontForPreset: vi.fn(() => ({ id: 'bundle-x' })),
}));

vi.mock('./mathjaxRenderer', () => ({
  renderMathInHtml: vi.fn(async (html: string) => `DEFAULT_RENDERED(${html})`),
  containsMath: vi.fn((html: string) => html.includes('$')),
}));

// Dynamic imports inside the module.
vi.mock('modern-screenshot', () => ({
  domToDataUrl: vi.fn(async () => 'data:image/png;base64,LIVE'),
}));
vi.mock('./assetRenderer', () => ({
  renderAsset: vi.fn(async () => {}),
}));
vi.mock('./assetCache', () => ({
  ASSET_TIER: { full: 2048 },
}));

import { invoke } from '@tauri-apps/api/core';
import { isLivePrintElement, preparePrintLayer } from './printLayer';
import { loadPreviewDataUrl, isPreviewThemeStale } from './previewCache';
import { renderMathInHtml, containsMath } from './mathjaxRenderer';
import { domToDataUrl } from 'modern-screenshot';
import type { Presentation } from '../types/presentation';

// ---- helpers ----

const bufOf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;

type AnyEl = Record<string, unknown>;
const el = (over: AnyEl): AnyEl => ({
  id: 'e',
  type: 'text',
  position: { x: 0, y: 0, width: 100, height: 80 },
  ...over,
});

const pres = (slides: Array<{ id: string; theme?: unknown; elements: AnyEl[] }>): Presentation =>
  ({
    theme: { name: 'deck' },
    config: { mathPreamble: '\\newcommand{\\x}{x}' },
    slides,
  } as unknown as Presentation);

const defaultInvoke = async (cmd: string) => {
  switch (cmd) {
    case 'db_get_asset_cache_bytes':
      return bufOf([1, 2, 3, 4]);
    case 'db_get_asset_meta_by_id':
      return { mime_type: 'image/png', path: '/a/b.png' };
    case 'db_get_asset_by_id':
      return bufOf([9, 9, 9]);
    default:
      return null;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  buildCalls.length = 0;
  // Re-establish default implementations (clearAllMocks keeps impls, but tests
  // that install `.mockResolvedValue` persist — reset them to known defaults).
  vi.mocked(loadPreviewDataUrl).mockImplementation(async () => null);
  vi.mocked(isPreviewThemeStale).mockImplementation(async () => false);
  vi.mocked(containsMath).mockImplementation((html: string) => html.includes('$'));
  vi.mocked(renderMathInHtml).mockImplementation(async (html: string) => `DEFAULT_RENDERED(${html})`);
  vi.mocked(domToDataUrl).mockImplementation(async () => 'data:image/png;base64,LIVE');
  vi.mocked(invoke).mockImplementation(defaultInvoke as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.className = '';
  document.body.innerHTML = '';
});

// ============================================================================
describe('isLivePrintElement', () => {
  it('classifies the four bake-to-screenshot types as live', () => {
    for (const t of ['demo', 'demo-piece', 'video', 'notebook']) {
      expect(isLivePrintElement(t)).toBe(true);
    }
  });

  it('classifies everything else as not-live', () => {
    for (const t of ['text', 'image', 'arrow', 'cover', 'html', '', 'DEMO']) {
      expect(isLivePrintElement(t)).toBe(false);
    }
  });
});

// ============================================================================
describe('preparePrintLayer — slide assembly', () => {
  it('returns one built html per slide, in order, numbered from 1', async () => {
    const p = pres([
      { id: 's1', elements: [el({ id: 't1', type: 'text', html: 'hi' })] },
      { id: 's2', elements: [] },
    ]);
    const { slideHtmls } = await preparePrintLayer(p);
    expect(slideHtmls).toEqual(['SLIDE#1:s1', 'SLIDE#2:s2']);
    // buildPrintSlideHtml gets (slide, presentation, imageCache, shots, math, n)
    expect(buildCalls).toHaveLength(2);
    expect(buildCalls[0][5]).toBe(1);
    expect(buildCalls[1][5]).toBe(2);
  });

  it('short-circuits screenshot gathering when no live elements exist', async () => {
    const p = pres([{ id: 's1', elements: [el({ id: 't1', type: 'text', html: 'x' })] }]);
    await preparePrintLayer(p);
    // No live elements => never consults the preview cache.
    expect(loadPreviewDataUrl).not.toHaveBeenCalled();
    // demoScreenshots map handed to build should be empty.
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.size).toBe(0);
  });
});

// ============================================================================
describe('preparePrintLayer — math pre-render', () => {
  it('renders only text elements that contain math, keyed by slideId:elementId', async () => {
    const p = pres([
      {
        id: 's1',
        elements: [
          el({ id: 'm', type: 'text', html: 'value $x$' }),
          el({ id: 'plain', type: 'text', html: 'no math here' }),
          el({ id: 'empty', type: 'text', html: '' }),
          el({ id: 'img', type: 'image', assetId: 'a1', html: '$y$' }),
        ],
      },
    ]);
    await preparePrintLayer(p);
    const mathMap = buildCalls[0][4] as Map<string, string>;
    expect(mathMap.get('s1:m')).toBe('DEFAULT_RENDERED(value $x$)');
    expect(mathMap.has('s1:plain')).toBe(false); // containsMath false
    expect(mathMap.has('s1:empty')).toBe(false); // empty html falsy
    expect(mathMap.has('s1:img')).toBe(false); // not a text element
    expect(renderMathInHtml).toHaveBeenCalledTimes(1);
  });

  it('uses a caller-supplied renderMath instead of the default', async () => {
    const customRender = vi.fn(async (html: string) => `CUSTOM(${html})`);
    const p = pres([{ id: 's1', elements: [el({ id: 'm', type: 'text', html: '$z$' })] }]);
    await preparePrintLayer(p, { renderMath: customRender });
    const mathMap = buildCalls[0][4] as Map<string, string>;
    expect(mathMap.get('s1:m')).toBe('CUSTOM($z$)');
    expect(customRender).toHaveBeenCalledWith('$z$', 'bundle-x', '\\newcommand{\\x}{x}');
    expect(renderMathInHtml).not.toHaveBeenCalled();
  });

  it('falls back to the raw html when the math renderer rejects', async () => {
    vi.mocked(renderMathInHtml).mockRejectedValue(new Error('mathjax boom'));
    const p = pres([{ id: 's1', elements: [el({ id: 'm', type: 'text', html: '$broken$' })] }]);
    await preparePrintLayer(p);
    const mathMap = buildCalls[0][4] as Map<string, string>;
    expect(mathMap.get('s1:m')).toBe('$broken$');
  });

  it('passes an empty preamble string through when config.mathPreamble is absent', async () => {
    const p = {
      theme: {},
      config: {},
      slides: [{ id: 's1', elements: [el({ id: 'm', type: 'text', html: '$q$' })] }],
    } as unknown as Presentation;
    await preparePrintLayer(p);
    expect(renderMathInHtml).toHaveBeenCalledWith('$q$', 'bundle-x', '');
  });
});

// ============================================================================
describe('preparePrintLayer — screenshot gathering (cached path)', () => {
  it('uses a cached preview for a live element', async () => {
    vi.mocked(loadPreviewDataUrl).mockResolvedValue('data:image/png;base64,CACHED');
    const p = pres([{ id: 's1', elements: [el({ id: 'd', type: 'demo' })] }]);
    await preparePrintLayer(p);
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.get('s1:d')).toBe('data:image/png;base64,CACHED');
    // With no misses, live capture never runs.
    expect(domToDataUrl).not.toHaveBeenCalled();
  });

  it('skips a theme-stale notebook preview so it is treated as a miss', async () => {
    vi.mocked(isPreviewThemeStale).mockResolvedValue(true);
    vi.mocked(loadPreviewDataUrl).mockResolvedValue('data:should-not-be-used');
    const onNeeds = vi.fn();
    const p = pres([{ id: 's1', elements: [el({ id: 'nb', type: 'notebook' })] }]);
    await preparePrintLayer(p, { onNeedsLiveCapture: onNeeds });
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.has('s1:nb')).toBe(false); // stale -> skipped -> not cached
    expect(loadPreviewDataUrl).not.toHaveBeenCalled(); // continue hit before load
    expect(onNeeds).toHaveBeenCalledTimes(1); // there is a miss
  });

  it('keeps a fresh notebook preview from the cache', async () => {
    vi.mocked(isPreviewThemeStale).mockResolvedValue(false);
    vi.mocked(loadPreviewDataUrl).mockResolvedValue('data:nb-cached');
    const p = pres([{ id: 's1', elements: [el({ id: 'nb', type: 'notebook' })] }]);
    await preparePrintLayer(p);
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.get('s1:nb')).toBe('data:nb-cached');
  });

  it('calls onNeedsLiveCapture then returns cached-only when liveCapture is off (CLI)', async () => {
    vi.mocked(loadPreviewDataUrl).mockResolvedValue(null); // a miss
    const onNeeds = vi.fn();
    const p = pres([{ id: 's1', elements: [el({ id: 'd', type: 'demo' })] }]);
    await preparePrintLayer(p, { liveCapture: false, onNeedsLiveCapture: onNeeds });
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(onNeeds).toHaveBeenCalledTimes(1);
    expect(shots.has('s1:d')).toBe(false);
    expect(domToDataUrl).not.toHaveBeenCalled();
  });
});

// ============================================================================
describe('preparePrintLayer — live flip-through capture', () => {
  beforeEach(() => {
    // Make the 500ms "let demos render" wait instant.
    vi.stubGlobal('setTimeout', (fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  it('captures uncached live elements via domToDataUrl and toggles the capture class', async () => {
    vi.mocked(loadPreviewDataUrl).mockResolvedValue(null);
    // The element must exist in the DOM for querySelector to find it.
    document.body.innerHTML = '<div data-element-id="d"></div>';
    const observed: boolean[] = [];
    vi.mocked(domToDataUrl).mockImplementation(async () => {
      observed.push(document.body.classList.contains('pdf-capturing'));
      return 'data:image/png;base64,LIVECAP';
    });

    const p = pres([{ id: 's1', elements: [el({ id: 'd', type: 'demo' })] }]);
    await preparePrintLayer(p, { liveCapture: true });

    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.get('s1:d')).toBe('data:image/png;base64,LIVECAP');
    expect(observed).toEqual([true]); // class present during capture
    expect(document.body.classList.contains('pdf-capturing')).toBe(false); // cleaned up
    expect(selectSlide).toHaveBeenCalledWith(0); // restore original index in finally
  });

  it('skips a slide with no misses and elements with no matching DOM node', async () => {
    // s1 fully cached (no miss). s2 has a miss but its DOM node is absent.
    vi.mocked(loadPreviewDataUrl).mockImplementation(async (key: string) =>
      key === 'pk:cached' ? 'data:hit' : null,
    );
    // No DOM node for 'missing'.
    document.body.innerHTML = '';
    const p = pres([
      { id: 's1', elements: [el({ id: 'cached', type: 'demo' })] },
      { id: 's2', elements: [el({ id: 'missing', type: 'demo' })] },
    ]);
    await preparePrintLayer(p, { liveCapture: true });
    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.get('s1:cached')).toBe('data:hit');
    expect(shots.has('s2:missing')).toBe(false); // querySelector null -> skipped
    expect(domToDataUrl).not.toHaveBeenCalled();
  });

  it('swallows a domToDataUrl failure and still cleans up', async () => {
    vi.mocked(loadPreviewDataUrl).mockResolvedValue(null);
    document.body.innerHTML = '<div data-element-id="d"></div>';
    vi.mocked(domToDataUrl).mockRejectedValue(new Error('capture failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const p = pres([{ id: 's1', elements: [el({ id: 'd', type: 'demo' })] }]);
    const { slideHtmls } = await preparePrintLayer(p, { liveCapture: true });

    const shots = buildCalls[0][3] as Map<string, string>;
    expect(shots.has('s1:d')).toBe(false); // capture threw -> not set
    expect(warn).toHaveBeenCalled();
    expect(document.body.classList.contains('pdf-capturing')).toBe(false);
    expect(slideHtmls).toEqual(['SLIDE#1:s1']);
    warn.mockRestore();
  });
});

// ============================================================================
describe('preparePrintLayer — image cache', () => {
  it('embeds a raster image using its stored mime type', async () => {
    const p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', assetId: 'a1' })] }]);
    await preparePrintLayer(p);
    const cache = buildCalls[0][2] as Map<string, string>;
    expect(cache.get('a1')).toBe('data:image/png;base64,B64');
    expect(invoke).toHaveBeenCalledWith('db_get_asset_meta_by_id', { assetId: 'a1' });
  });

  it('derives an svg mime from the file extension when meta has none', async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: null, path: '/x/logo.SVG' };
      if (cmd === 'db_get_asset_by_id') return bufOf([1]);
      return null;
    }) as never);
    const p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', assetId: 'svgA' })] }]);
    await preparePrintLayer(p);
    const cache = buildCalls[0][2] as Map<string, string>;
    expect(cache.get('svgA')).toBe('data:image/svg+xml;base64,B64');
  });

  it('maps jpg extension to image/jpeg and defaults a pathless asset to png', async () => {
    // jpg case
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: null, path: 'photo.jpg' };
      if (cmd === 'db_get_asset_by_id') return bufOf([2]);
      return null;
    }) as never);
    let p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', assetId: 'jpgA' })] }]);
    await preparePrintLayer(p);
    expect((buildCalls[0][2] as Map<string, string>).get('jpgA')).toBe('data:image/jpeg;base64,B64');

    // null meta -> ext defaults to png
    buildCalls.length = 0;
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return null;
      if (cmd === 'db_get_asset_by_id') return bufOf([3]);
      return null;
    }) as never);
    p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', assetId: 'noMeta' })] }]);
    await preparePrintLayer(p);
    expect((buildCalls[0][2] as Map<string, string>).get('noMeta')).toBe('data:image/png;base64,B64');
  });

  it('rasterizes a pdf image through the pdfium cache PNG', async () => {
    const p = pres([
      { id: 's1', elements: [el({ id: 'i', type: 'image', kind: 'pdf', assetId: 'pdfA', snapshotVariant: 'v2' })] },
    ]);
    await preparePrintLayer(p);
    const cache = buildCalls[0][2] as Map<string, string>;
    expect(cache.get('pdfA')).toBe('data:image/png;base64,B64');
    expect(invoke).toHaveBeenCalledWith('db_get_asset_cache_bytes', {
      sourceId: 'pdfA',
      variant: 'v2',
      width: 2048,
      height: 2048,
    });
  });

  it('omits a pdf whose rasterized cache is empty', async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'db_get_asset_cache_bytes') return bufOf([]); // zero-length
      return null;
    }) as never);
    const p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', kind: 'pdf', assetId: 'emptyPdf' })] }]);
    await preparePrintLayer(p);
    expect((buildCalls[0][2] as Map<string, string>).has('emptyPdf')).toBe(false);
  });

  it('deduplicates by assetId across slides and elements', async () => {
    const p = pres([
      { id: 's1', elements: [el({ id: 'a', type: 'image', assetId: 'shared' })] },
      { id: 's2', elements: [el({ id: 'b', type: 'image', assetId: 'shared' })] },
    ]);
    await preparePrintLayer(p);
    const metaCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'db_get_asset_meta_by_id');
    expect(metaCalls).toHaveLength(1); // fetched once, reused
    const cache = buildCalls[0][2] as Map<string, string>;
    expect(cache.get('shared')).toBe('data:image/png;base64,B64');
  });

  it('skips a failed asset fetch without aborting the whole layer', async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') throw new Error('db gone');
      return null;
    }) as never);
    const p = pres([{ id: 's1', elements: [el({ id: 'i', type: 'image', assetId: 'bad' })] }]);
    const { slideHtmls } = await preparePrintLayer(p);
    expect((buildCalls[0][2] as Map<string, string>).has('bad')).toBe(false);
    expect(slideHtmls).toEqual(['SLIDE#1:s1']); // still produced
  });

  it('ignores non-image elements when building the image cache', async () => {
    const p = pres([{ id: 's1', elements: [el({ id: 't', type: 'text', html: 'plain' })] }]);
    await preparePrintLayer(p);
    expect(invoke).not.toHaveBeenCalledWith('db_get_asset_meta_by_id', expect.anything());
    expect((buildCalls[0][2] as Map<string, string>).size).toBe(0);
  });
});
