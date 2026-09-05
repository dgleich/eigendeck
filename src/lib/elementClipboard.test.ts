import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock external boundaries -------------------------------------------------
// Tauri IPC: every clip_* / db_* call goes through invoke.
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

// Theme + font + mathjax boundaries: stub so textElementClipboardHtml's string
// building is deterministic and doesn't pull in real font/mathjax machinery.
vi.mock('./themes', () => ({
  resolveTheme: vi.fn(() => ({ background: '#fff', foreground: '#000' })),
  themeColorForPreset: vi.fn(() => '#123456'),
}));
vi.mock('./fonts', () => ({
  fontForPreset: vi.fn(() => ({ id: 'pt-sans' })),
  fontFamilyForPreset: vi.fn(() => 'PT Sans Fallback'),
}));
const renderMathInHtmlSync = vi.fn();
const containsMath = vi.fn();
vi.mock('./mathjaxRenderer', () => ({
  renderMathInHtmlSync: (...a: unknown[]) => renderMathInHtmlSync(...a),
  containsMath: (...a: unknown[]) => containsMath(...a),
}));

import {
  isCopyableAsset,
  copyAssetElement,
  clearInternalClip,
  textElementClipboardHtml,
  hasFreshInternalAsset,
  pasteAssetElement,
} from './elementClipboard';
import type { SlideElement, TextElement, Slide, PresentationConfig } from '../types/presentation';

// Convenience builders ---------------------------------------------------------
function imageEl(overrides: Record<string, unknown> = {}): SlideElement {
  return {
    id: 'el-1', type: 'image', assetId: 'asset-1',
    x: 0, y: 0, width: 10, height: 10,
    ...overrides,
  } as unknown as SlideElement;
}

beforeEach(() => {
  invoke.mockReset();
  renderMathInHtmlSync.mockReset();
  containsMath.mockReset();
  containsMath.mockReturnValue(false);
});

// -----------------------------------------------------------------------------
describe('isCopyableAsset', () => {
  it('is true only for image elements that carry an assetId', () => {
    expect(isCopyableAsset(imageEl())).toBe(true);
  });
  it('is false for an image without an assetId', () => {
    expect(isCopyableAsset(imageEl({ assetId: undefined }))).toBe(false);
    expect(isCopyableAsset(imageEl({ assetId: '' }))).toBe(false);
  });
  it('is false for non-image element types even with an assetId', () => {
    expect(isCopyableAsset({ id: 't', type: 'text', assetId: 'x' } as unknown as SlideElement)).toBe(false);
    expect(isCopyableAsset({ id: 'a', type: 'arrow' } as unknown as SlideElement)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('copyAssetElement', () => {
  it('returns false without touching Tauri when the element is not a copyable asset', async () => {
    const ok = await copyAssetElement({ id: 't', type: 'text' } as unknown as SlideElement);
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('copies with meta mime, strips identity fields, and derives ext from meta.path', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/jpeg', path: 'a/b/pic.JPeG' };
      if (cmd === 'db_get_project_id') return 'deck-42';
      if (cmd === 'clip_copy_asset') return undefined;
      return null;
    });
    const el = imageEl({ syncId: 'sync-9', linkId: 'link-9', _syncId: 'x', foo: 'keep' });
    const ok = await copyAssetElement(el, { fromSlideId: 's-1', fromSlideIndex: 3 });
    expect(ok).toBe(true);

    const call = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')!;
    const args = call[1] as { assetId: string; payload: string; mime: string };
    expect(args.assetId).toBe('asset-1');
    expect(args.mime).toBe('image/jpeg');
    const payload = JSON.parse(args.payload);
    // ext derived from the path extension, lowercased.
    expect(payload.ext).toBe('jpeg');
    expect(payload.v).toBe(1);
    expect(payload.sourceDeckId).toBe('deck-42');
    expect(payload.fromSlideId).toBe('s-1');
    expect(payload.fromSlideIndex).toBe(3);
    expect(payload.sourceId).toBe('el-1');
    expect(payload.sourceSyncId).toBe('sync-9');
    // detachedFields removed identity, kept renderable fields.
    expect(payload.element.foo).toBe('keep');
    for (const k of ['id', 'assetId', 'syncId', '_syncId', 'linkId', '_linkId']) {
      expect(payload.element).not.toHaveProperty(k);
    }
  });

  it('falls back to svg mime + ext from element.kind when asset meta is missing', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return null;
      if (cmd === 'db_get_project_id') return 'deck-1';
      return undefined;
    });
    await copyAssetElement(imageEl({ kind: 'svg' }));
    const args = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')![1] as { mime: string; payload: string };
    expect(args.mime).toBe('image/svg+xml');
    expect(JSON.parse(args.payload).ext).toBe('svg');
  });

  it('falls back to pdf mime + ext when kind is pdf and meta is missing', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return null;
      if (cmd === 'db_get_project_id') return 'deck-1';
      return undefined;
    });
    await copyAssetElement(imageEl({ kind: 'pdf' }));
    const args = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')![1] as { mime: string; payload: string };
    expect(args.mime).toBe('application/pdf');
    expect(JSON.parse(args.payload).ext).toBe('pdf');
  });

  it('defaults to png mime/ext when there is neither meta nor a recognized kind', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return {}; // meta present, no mime_type/path
      if (cmd === 'db_get_project_id') return 'deck-1';
      return undefined;
    });
    await copyAssetElement(imageEl());
    const args = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')![1] as { mime: string; payload: string };
    expect(args.mime).toBe('image/png');
    expect(JSON.parse(args.payload).ext).toBe('png');
  });

  it('treats an unsaved deck (db_get_project_id throws) as a null sourceDeckId and still copies', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/png' };
      if (cmd === 'db_get_project_id') throw new Error('no project');
      return undefined;
    });
    const ok = await copyAssetElement(imageEl());
    expect(ok).toBe(true);
    const args = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')![1] as { payload: string };
    expect(JSON.parse(args.payload).sourceDeckId).toBeNull();
  });

  it('returns false and warns when the underlying clip_copy_asset call throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/png' };
      if (cmd === 'db_get_project_id') return 'd';
      if (cmd === 'clip_copy_asset') throw new Error('boom');
      return undefined;
    });
    const ok = await copyAssetElement(imageEl());
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('omits slide context fields when no ctx is provided', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/png' };
      if (cmd === 'db_get_project_id') return 'd';
      return undefined;
    });
    await copyAssetElement(imageEl());
    const args = invoke.mock.calls.find((c) => c[0] === 'clip_copy_asset')![1] as { payload: string };
    const payload = JSON.parse(args.payload);
    expect(payload.fromSlideId).toBeUndefined();
    expect(payload.fromSlideIndex).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
describe('clearInternalClip', () => {
  it('invokes clip_clear_internal', async () => {
    invoke.mockResolvedValue(undefined);
    await clearInternalClip();
    expect(invoke).toHaveBeenCalledWith('clip_clear_internal');
  });
  it('swallows errors', async () => {
    invoke.mockRejectedValue(new Error('nope'));
    await expect(clearInternalClip()).resolves.toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
describe('textElementClipboardHtml', () => {
  const slide = { theme: undefined } as unknown as Slide;
  const config = {} as unknown as PresentationConfig;
  function textEl(overrides: Partial<TextElement> = {}): TextElement {
    return {
      id: 'tx', type: 'text', preset: 'body', html: 'Hello',
      x: 0, y: 0, width: 5, height: 5,
      ...overrides,
    } as unknown as TextElement;
  }

  it('wraps non-math html in a styled div using the resolved font/size/color', () => {
    const { styledHtml } = textElementClipboardHtml(textEl({ html: '<b>Hi</b>' }), slide, config, 'light');
    expect(styledHtml).toContain('<b>Hi</b>');
    expect(styledHtml).toMatch(/^<div style="font-family:PT Sans Fallback;/);
    expect(styledHtml).toContain('font-weight:normal');
    expect(styledHtml).toContain('line-height:1.3;');
    // renderMathInHtmlSync must NOT run when there's no math.
    expect(renderMathInHtmlSync).not.toHaveBeenCalled();
  });

  it('prefers an explicit element.fontFamily over the preset fallback', () => {
    const { styledHtml } = textElementClipboardHtml(textEl({ fontFamily: 'Courier' }), slide, config, 'light');
    expect(styledHtml).toContain('font-family:Courier;');
  });

  it('renders math through mathjax when the html contains math', () => {
    containsMath.mockReturnValue(true);
    renderMathInHtmlSync.mockReturnValue('<svg>rendered</svg>');
    const { styledHtml } = textElementClipboardHtml(textEl({ html: '$x$' }), slide, config, 'light');
    expect(renderMathInHtmlSync).toHaveBeenCalled();
    expect(styledHtml).toContain('<svg>rendered</svg>');
  });

  it('falls back to the raw html when the math renderer returns null', () => {
    containsMath.mockReturnValue(true);
    renderMathInHtmlSync.mockReturnValue(null);
    const { styledHtml } = textElementClipboardHtml(textEl({ html: '$y$' }), slide, config, 'light');
    expect(styledHtml).toContain('$y$');
  });

  it('produces plain text: strips tags, decodes entities, converts breaks to newlines', () => {
    const { plain } = textElementClipboardHtml(
      textEl({ html: 'a<br>b<br/>c<p>d</p><div>e</div>' }), slide, config, 'light',
    );
    // Only CLOSING block tags become newlines; the opening <p> is just stripped,
    // so "c" and "d" merge into "cd".
    expect(plain).toBe('a\nb\ncd\ne');
  });

  it('decodes named entities and collapses whitespace in plain text', () => {
    const { plain } = textElementClipboardHtml(
      textEl({ html: 'x&nbsp;&amp;&lt;y&gt;   z' }), slide, config, 'light',
    );
    expect(plain).toBe('x &<y> z');
  });

  it('handles empty html without throwing', () => {
    const { styledHtml, plain } = textElementClipboardHtml(textEl({ html: '' }), slide, config, 'light');
    expect(plain).toBe('');
    expect(styledHtml).toContain('<div style=');
  });
});

// -----------------------------------------------------------------------------
describe('hasFreshInternalAsset', () => {
  it('is true when the peek reports bytes present', async () => {
    invoke.mockResolvedValue({ payload: '{}', mime: 'image/png', has_bytes: true });
    expect(await hasFreshInternalAsset()).toBe(true);
  });
  it('is false when the peek reports no bytes', async () => {
    invoke.mockResolvedValue({ payload: '{}', mime: 'image/png', has_bytes: false });
    expect(await hasFreshInternalAsset()).toBe(false);
  });
  it('is false when the peek returns null', async () => {
    invoke.mockResolvedValue(null);
    expect(await hasFreshInternalAsset()).toBe(false);
  });
  it('is false when the peek call throws', async () => {
    invoke.mockRejectedValue(new Error('x'));
    expect(await hasFreshInternalAsset()).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('pasteAssetElement', () => {
  it('returns null when the peek call throws', async () => {
    invoke.mockRejectedValue(new Error('x'));
    expect(await pasteAssetElement()).toBeNull();
  });

  it('returns null when there is no fresh internal clip', async () => {
    invoke.mockResolvedValue({ payload: '{}', mime: '', has_bytes: false });
    expect(await pasteAssetElement()).toBeNull();
  });

  it('returns null when the payload JSON is malformed', async () => {
    invoke.mockResolvedValue({ payload: 'not json{', mime: '', has_bytes: true });
    expect(await pasteAssetElement()).toBeNull();
  });

  it('returns null and warns when clip_paste_asset throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'clip_peek_internal') return { payload: JSON.stringify({ v: 1, element: {}, ext: 'png' }), mime: '', has_bytes: true };
      if (cmd === 'clip_paste_asset') throw new Error('paste fail');
      return null;
    });
    expect(await pasteAssetElement()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null when clip_paste_asset resolves to null', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'clip_peek_internal') return { payload: JSON.stringify({ v: 1, element: {}, ext: 'png' }), mime: '', has_bytes: true };
      if (cmd === 'clip_paste_asset') return null;
      return null;
    });
    expect(await pasteAssetElement()).toBeNull();
  });

  it('rebuilds a fresh element (new id + assetId) and returns link metadata', async () => {
    const payload = {
      v: 1,
      element: { type: 'image', width: 100, height: 50, kind: 'png' },
      ext: 'png',
      fromSlideId: 'slide-A', sourceId: 'src-1', sourceSyncId: 'sync-1',
    };
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'clip_peek_internal') return { payload: JSON.stringify(payload), mime: '', has_bytes: true };
      if (cmd === 'clip_paste_asset') {
        // The generated path should carry the payload ext.
        expect((args as { path: string }).path).toMatch(/^images\/pasted-\d+\.png$/);
        return { asset_id: 'new-asset', payload: '' };
      }
      return null;
    });
    const result = await pasteAssetElement();
    expect(result).not.toBeNull();
    const { element, link } = result!;
    const e = element as unknown as Record<string, unknown>;
    expect(e.type).toBe('image');
    expect(e.width).toBe(100);
    expect(e.assetId).toBe('new-asset');
    expect(typeof e.id).toBe('string');
    expect((e.id as string).length).toBeGreaterThan(0);
    expect(link).toEqual({ fromSlideId: 'slide-A', sourceId: 'src-1', sourceSyncId: 'sync-1' });
  });

  it('defaults the paste path extension to png when the payload omits ext', async () => {
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'clip_peek_internal') return { payload: JSON.stringify({ v: 1, element: {} }), mime: '', has_bytes: true };
      if (cmd === 'clip_paste_asset') {
        expect((args as { path: string }).path).toMatch(/\.png$/);
        return { asset_id: 'a', payload: '' };
      }
      return null;
    });
    const result = await pasteAssetElement();
    expect(result).not.toBeNull();
  });
});
