import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clipboardRepresentations,
  gatherClipboardTypes,
  readRepresentation,
  type PasteKind,
} from './pasteAs';

// ---- Tauri IPC boundary -------------------------------------------------
// invokeSafe() dynamically imports '@tauri-apps/api/core'; route it to a knob
// tests set per case. Reject → invokeSafe swallows and returns null.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
}));

// ---- Clipboard helpers --------------------------------------------------

const enc = (s: string) => Array.from(new TextEncoder().encode(s));

interface FakeClipItem {
  types: string[];
  getType: (m: string) => Promise<Blob>;
}
function clipItem(map: Record<string, Uint8Array>): FakeClipItem {
  return {
    types: Object.keys(map),
    getType: async (m: string) => new Blob([map[m]]),
  };
}

/** Install a fake navigator.clipboard (or remove it with null). */
function setClipboard(cb: Partial<Clipboard> | null): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: cb === null ? undefined : cb,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  // Default: no native pasteboard command available.
  invokeMock.mockRejectedValue(new Error('no tauri'));
});

afterEach(() => {
  setClipboard(null);
});

// =========================================================================
// clipboardRepresentations — PURE classification
// =========================================================================

const kinds = (types: string[]) => clipboardRepresentations(types).map((r) => r.kind);

describe('clipboardRepresentations', () => {
  it('returns nothing for an empty or unknown clipboard', () => {
    expect(clipboardRepresentations([])).toEqual([]);
    expect(kinds(['application/x-whatever', 'com.acme.custom'])).toEqual([]);
  });

  it('maps a single graphics representation (native UTI or web MIME)', () => {
    expect(kinds(['public.png'])).toEqual(['image']);
    expect(kinds(['image/png'])).toEqual(['image']);
    expect(kinds(['image/jpeg'])).toEqual(['image']);
    expect(kinds(['public.svg-image'])).toEqual(['svg']);
    expect(kinds(['image/svg+xml'])).toEqual(['svg']);
    expect(kinds(['com.adobe.pdf'])).toEqual(['pdf']);
    expect(kinds(['application/pdf'])).toEqual(['pdf']);
  });

  it('collapses multiple aliases of the same kind to a single entry', () => {
    expect(kinds(['public.png', 'image/png', 'public.jpeg', 'image/tiff'])).toEqual(['image']);
  });

  it('is case-insensitive on the type tokens', () => {
    expect(kinds(['PUBLIC.PNG'])).toEqual(['image']);
    expect(kinds(['IMAGE/SVG+XML'])).toEqual(['svg']);
  });

  it('offers HTML alone (no Simple Image) when text is absent', () => {
    expect(kinds(['public.html'])).toEqual(['html']);
    expect(kinds(['text/html'])).toEqual(['html']);
  });

  it('offers Text alone', () => {
    expect(kinds(['text/plain'])).toEqual(['text']);
    expect(kinds(['public.utf8-plain-text'])).toEqual(['text']);
    expect(kinds(['text/rtf'])).toEqual(['text']);
  });

  it('offers Simple Image (html-image) ONLY when both HTML and text are present', () => {
    // rich copy (browser / Word / Docs): html + text → rasterize option appears
    expect(kinds(['text/html', 'text/plain'])).toEqual(['html-image', 'html', 'text']);
    // rtf counts as text for the "both" rule
    expect(kinds(['public.html', 'public.rtf'])).toEqual(['html-image', 'html', 'text']);
    // html without any text flavor → no html-image
    expect(kinds(['text/html'])).not.toContain('html-image');
  });

  it('orders richest-graphics-first, text last', () => {
    const all = ['public.png', 'image/svg+xml', 'application/pdf', 'text/html', 'text/plain'];
    expect(kinds(all)).toEqual(['image', 'svg', 'pdf', 'html-image', 'html', 'text']);
  });

  it('every returned rep carries a human label', () => {
    for (const r of clipboardRepresentations(['public.png', 'text/html', 'text/plain'])) {
      expect(typeof r.label).toBe('string');
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

// =========================================================================
// gatherClipboardTypes — union of native UTIs + async Clipboard MIME types
// =========================================================================

describe('gatherClipboardTypes', () => {
  it('unions native pasteboard UTIs and async Clipboard MIME types, deduped', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'pasteboard_list_types' ? ['public.png', 'public.html'] : null,
    );
    setClipboard({
      read: async () => [clipItem({ 'text/html': new Uint8Array(), 'text/plain': new Uint8Array() })],
    } as unknown as Clipboard);

    const types = await gatherClipboardTypes();
    expect(types).toContain('public.png');
    expect(types).toContain('public.html');
    expect(types).toContain('text/html');
    expect(types).toContain('text/plain');
    // deduped (Set-backed)
    expect(new Set(types).size).toBe(types.length);
  });

  it('returns async-only types when the native command is unavailable', async () => {
    // invokeMock rejects by default → invokeSafe returns null.
    setClipboard({
      read: async () => [clipItem({ 'image/png': new Uint8Array() })],
    } as unknown as Clipboard);

    expect(await gatherClipboardTypes()).toEqual(['image/png']);
  });

  it('returns native-only types when clipboard.read throws (permission/focus)', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'pasteboard_list_types' ? ['com.adobe.pdf'] : null,
    );
    setClipboard({
      read: async () => { throw new Error('not focused'); },
    } as unknown as Clipboard);

    expect(await gatherClipboardTypes()).toEqual(['com.adobe.pdf']);
  });

  it('returns native-only types when there is no async Clipboard API', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'pasteboard_list_types' ? ['public.tiff'] : null,
    );
    setClipboard(null); // navigator.clipboard === undefined

    expect(await gatherClipboardTypes()).toEqual(['public.tiff']);
  });

  it('returns an empty list when neither source yields types', async () => {
    invokeMock.mockResolvedValue(null); // native returns null (not an array)
    setClipboard(null);
    expect(await gatherClipboardTypes()).toEqual([]);
  });
});

// =========================================================================
// readRepresentation — native-first byte/text read for the chosen kind
// =========================================================================

describe('readRepresentation', () => {
  it('returns null for an unknown kind (no matching spec)', async () => {
    expect(await readRepresentation('nope' as unknown as PasteKind)).toBeNull();
  });

  // ---- text ----
  it('reads text from the native utf8 pasteboard type', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pasteboard_read_type' && args.uti === 'public.utf8-plain-text') return enc('hi native');
      return null;
    });
    expect(await readRepresentation('text')).toEqual({ kind: 'text', text: 'hi native' });
  });

  it('falls back to public.text when utf8 is empty', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pasteboard_read_type' && args.uti === 'public.utf8-plain-text') return [];
      if (cmd === 'pasteboard_read_type' && args.uti === 'public.text') return enc('plain text');
      return null;
    });
    expect(await readRepresentation('text')).toEqual({ kind: 'text', text: 'plain text' });
  });

  it('falls back to the async clipboard readText when native bytes are absent', async () => {
    setClipboard({ readText: async () => 'web text' } as unknown as Clipboard);
    const rep = await readRepresentation('text');
    expect(rep).toEqual({ kind: 'text', text: 'web text' });
  });

  it('returns null for text when no source has anything', async () => {
    setClipboard({ readText: async () => '' } as unknown as Clipboard);
    expect(await readRepresentation('text')).toBeNull();
  });

  it('swallows a rejecting readText and returns null', async () => {
    setClipboard({ readText: async () => { throw new Error('denied'); } } as unknown as Clipboard);
    expect(await readRepresentation('text')).toBeNull();
  });

  // ---- html / html-image ----
  it('reads html from the native public.html type', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pasteboard_read_type' && args.uti === 'public.html') return enc('<b>x</b>');
      return null;
    });
    expect(await readRepresentation('html')).toEqual({ kind: 'html', html: '<b>x</b>' });
  });

  it('reads html for html-image via the async clipboard when native is empty', async () => {
    setClipboard({
      read: async () => [clipItem({ 'text/html': new TextEncoder().encode('<i>web</i>') })],
    } as unknown as Clipboard);
    expect(await readRepresentation('html-image')).toEqual({ kind: 'html-image', html: '<i>web</i>' });
  });

  it('returns null for html when neither native nor async has it', async () => {
    setClipboard({ read: async () => [clipItem({ 'text/plain': new Uint8Array() })] } as unknown as Clipboard);
    expect(await readRepresentation('html')).toBeNull();
  });

  // ---- image / svg / pdf (raw bytes) ----
  it('reads image bytes from the first matching native type, with mime+ext', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pasteboard_read_type' && args.uti === 'public.png') return [1, 2, 3];
      return null;
    });
    const rep = await readRepresentation('image');
    expect(rep?.kind).toBe('image');
    expect(rep?.mime).toBe('image/png');
    expect(rep?.ext).toBe('png');
    expect(Array.from(rep!.bytes!)).toEqual([1, 2, 3]);
  });

  it('reads svg bytes from the async clipboard when native is unavailable', async () => {
    const svg = new TextEncoder().encode('<svg/>');
    setClipboard({
      read: async () => [clipItem({ 'image/svg+xml': svg })],
    } as unknown as Clipboard);
    const rep = await readRepresentation('svg');
    expect(rep?.kind).toBe('svg');
    expect(rep?.mime).toBe('image/svg+xml');
    expect(rep?.ext).toBe('svg');
    expect(Array.from(rep!.bytes!)).toEqual(Array.from(svg));
  });

  it('reads pdf bytes from a native type', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pasteboard_read_type' && args.uti === 'application/pdf') return [37, 80];
      return null;
    });
    const rep = await readRepresentation('pdf');
    expect(rep?.kind).toBe('pdf');
    expect(rep?.mime).toBe('application/pdf');
    expect(rep?.ext).toBe('pdf');
    expect(Array.from(rep!.bytes!)).toEqual([37, 80]);
  });

  it('returns null for a graphics kind when the clipboard has nothing matching', async () => {
    setClipboard({ read: async () => [clipItem({ 'text/plain': new Uint8Array() })] } as unknown as Clipboard);
    expect(await readRepresentation('image')).toBeNull();
  });
});
