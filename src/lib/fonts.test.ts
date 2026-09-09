import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildEmbeddedFontFacesCSS,
  injectFontFaces,
  allFontFacesCSS,
} from './fonts';

// fonts.ts is a thin browser/Tauri layer over the pure fontRegistry.mjs:
// the two functions with real logic are buildEmbeddedFontFacesCSS (fetch +
// WOFF2-prefer/format fallback + narrow-family selection + error swallow) and
// injectFontFaces (idempotent <style> injection). We exercise both against the
// REAL registry data with fetch stubbed at the boundary.

type FetchResult = { ok: boolean; bytes?: Uint8Array };

/** Install a fetch stub whose behaviour is decided per-request-URL. */
function stubFetch(handler: (url: string) => FetchResult | never) {
  const fn = vi.fn(async (url: string) => {
    const r = handler(url);
    return {
      ok: r.ok,
      arrayBuffer: async () => (r.bytes ?? new Uint8Array([1, 2, 3])).buffer,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const lines = (css: string) => (css === '' ? [] : css.split('\n'));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildEmbeddedFontFacesCSS', () => {
  it('prefers the WOFF2 sibling when it exists (default Lato font)', async () => {
    // Empty presentation still pulls in DEFAULT_FONT_ID = lato (static ttf,
    // 4 faces: regular/bold/italic/boldItalic).
    stubFetch((url) => ({ ok: url.endsWith('.woff2') }));
    const css = await buildEmbeddedFontFacesCSS({});
    const out = lines(css);
    expect(out).toHaveLength(4);
    for (const l of out) {
      expect(l).toContain("format('woff2')");
      expect(l).toContain('data:font/woff2;base64,');
      expect(l).toContain("font-family: 'Lato'");
      expect(l).toContain('font-display: swap;');
    }
    // weight/style spread across the four faces
    expect(css).toContain('font-weight: 400; font-style: normal;');
    expect(css).toContain('font-weight: 700; font-style: normal;');
    expect(css).toContain('font-weight: 400; font-style: italic;');
    expect(css).toContain('font-weight: 700; font-style: italic;');
  });

  it('requests the .woff2 URL derived from the ttf filename', async () => {
    const fetchFn = stubFetch((url) => ({ ok: url.endsWith('.woff2') }));
    await buildEmbeddedFontFacesCSS({});
    const urls = (fetchFn.mock.calls as unknown[][]).map((c) => c[0] as string);
    // every face is fetched as a .woff2 first, none fell through to a raw ttf
    expect(urls.every((u) => u.startsWith('/fonts/lato/'))).toBe(true);
    expect(urls).toContain('/fonts/lato/regular.woff2');
    expect(urls).toContain('/fonts/lato/bold-italic.woff2');
    expect(urls.some((u) => u.endsWith('.ttf'))).toBe(false);
  });

  it('falls back to the raw TTF (truetype) when no .woff2 exists', async () => {
    const fetchFn = stubFetch((url) => ({ ok: !url.endsWith('.woff2') }));
    const css = await buildEmbeddedFontFacesCSS({});
    const out = lines(css);
    expect(out).toHaveLength(4);
    for (const l of out) {
      expect(l).toContain("format('truetype')");
      expect(l).toContain('data:font/ttf;base64,');
    }
    // the fallback re-fetches the raw .ttf after the .woff2 miss
    const urls = (fetchFn.mock.calls as unknown[][]).map((c) => c[0] as string);
    expect(urls).toContain('/fonts/lato/regular.ttf');
  });

  it('falls back to opentype/otf mime for .otf packages', async () => {
    // libertinus is a static otf package
    stubFetch((url) => ({ ok: !url.endsWith('.woff2') }));
    const css = await buildEmbeddedFontFacesCSS({
      config: { defaultBodyFont: 'libertinus' },
    });
    const otfLines = lines(css).filter((l) => l.includes("font-family: 'Libertinus Serif'"));
    expect(otfLines.length).toBeGreaterThan(0);
    for (const l of otfLines) {
      expect(l).toContain("format('opentype')");
      expect(l).toContain('data:font/otf;base64,');
    }
  });

  it('skips a face entirely when both the woff2 and the raw file are missing', async () => {
    stubFetch(() => ({ ok: false }));
    const css = await buildEmbeddedFontFacesCSS({});
    expect(css).toBe('');
  });

  it('swallows fetch errors, warns, and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(() => {
      throw new Error('network down');
    });
    const css = await buildEmbeddedFontFacesCSS({});
    expect(css).toBe('');
    expect(warn).toHaveBeenCalled();
    const firstArg = (warn.mock.calls as unknown[][])[0][0] as string;
    expect(firstArg).toContain('Failed to embed font');
  });

  it('uses the narrow family name for narrow faces (PT Sans Narrow)', async () => {
    // ptsans is the only registered package with narrowFamily + narrow files.
    stubFetch((url) => ({ ok: url.endsWith('.woff2') }));
    const css = await buildEmbeddedFontFacesCSS({
      config: { defaultTitleFont: 'ptsans' },
    });
    const ptLines = lines(css);
    const narrow = ptLines.filter((l) => l.includes("font-family: 'PT Sans Narrow'"));
    const wide = ptLines.filter((l) => l.includes("font-family: 'PT Sans'"));
    expect(narrow.length).toBe(2); // narrowRegular + narrowBold
    expect(wide.length).toBeGreaterThan(0);
    // the narrow declarations still carry a data url + woff2 format
    for (const l of narrow) {
      expect(l).toContain('data:font/woff2;base64,');
      expect(l).toContain("format('woff2')");
    }
  });

  it('embeds every used font id including per-slide overrides', async () => {
    const fetchFn = stubFetch((url) => ({ ok: url.endsWith('.woff2') }));
    await buildEmbeddedFontFacesCSS({
      // defaultMonoFont is read by collectUsedFontIds but absent from the
      // narrower public param type; cast to reach that branch.
      config: { defaultMonoFont: 'jetbrains-mono' } as unknown as {
        defaultBodyFont?: string;
      },
      slides: [{ bodyFont: 'noto-sans' }, { titleFont: 'shantell' }],
    });
    const urls = (fetchFn.mock.calls as unknown[][]).map((c) => c[0] as string);
    const dirs = new Set(urls.map((u) => u.split('/')[2]));
    // lato (default) + the mono override + both per-slide overrides
    expect(dirs).toContain('lato');
    expect(dirs).toContain('jetbrains-mono');
    expect(dirs).toContain('noto-sans');
    expect(dirs).toContain('shantell');
  });

  it('ignores font ids that resolve in neither registry', async () => {
    const fetchFn = stubFetch((url) => ({ ok: url.endsWith('.woff2') }));
    const css = await buildEmbeddedFontFacesCSS({
      config: { defaultBodyFont: 'does-not-exist' },
    });
    const urls = (fetchFn.mock.calls as unknown[][]).map((c) => c[0] as string);
    // only lato (the default) is fetched; the bogus id is filtered out upstream
    expect(new Set(urls.map((u) => u.split('/')[2]))).toEqual(new Set(['lato']));
    expect(css).not.toContain('does-not-exist');
  });
});

describe('injectFontFaces', () => {
  beforeEach(() => {
    document.getElementById('eigendeck-font-faces')?.remove();
  });
  afterEach(() => {
    document.getElementById('eigendeck-font-faces')?.remove();
  });

  it('creates a single <style> block in <head> with the full face CSS', () => {
    injectFontFaces();
    const style = document.getElementById('eigendeck-font-faces') as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style!.tagName).toBe('STYLE');
    expect(style!.parentElement).toBe(document.head);
    expect(style!.textContent).toBe(allFontFacesCSS());
    expect(style!.textContent!.length).toBeGreaterThan(0);
  });

  it('is idempotent: repeated calls reuse the one element and refresh its text', () => {
    injectFontFaces();
    const first = document.getElementById('eigendeck-font-faces');
    first!.textContent = 'stale';
    injectFontFaces();
    const all = document.querySelectorAll('#eigendeck-font-faces');
    expect(all.length).toBe(1);
    // same node reused, content re-written to the current registry CSS
    expect(document.getElementById('eigendeck-font-faces')).toBe(first);
    expect(first!.textContent).toBe(allFontFacesCSS());
  });
});
