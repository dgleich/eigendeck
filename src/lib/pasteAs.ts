// "Paste as…" — let the user pick which representation on the clipboard to
// paste, instead of the automatic ladder (docs/copy-and-paste.md Stage 4).
//
// Two pure-ish pieces here:
//   • clipboardRepresentations(types) — map a raw pasteboard type/MIME list to
//     the offered choices (Image / SVG / PDF / HTML / Text). PURE + unit-tested.
//   • gatherClipboardTypes() / readRepresentation(kind) — talk to the OS
//     clipboard (native NSPasteboard on macOS, the async Clipboard API
//     elsewhere). The actual element INSERT is done by SlideEditor's existing
//     paste helpers (reused via a CustomEvent), so nothing is duplicated here.

// 'html-image' = rasterize the clipboard HTML to a STATIC image (the screenshot
// path), offered only when both HTML and text are present. Unlike the automatic
// ⌘V screenshot it's an explicit choice, and the capture never touches the
// network (see captureHtmlToPng) so it can't hang on a remote resource.
export type PasteKind = 'image' | 'svg' | 'pdf' | 'html-image' | 'html' | 'text';

export interface PasteRep {
  kind: PasteKind;
  label: string;
}

interface KindSpec {
  kind: PasteKind;
  label: string;
  /** Pasteboard UTIs + MIME aliases that indicate this representation. */
  types: string[];
  /** Asset kinds: canonical mime + extension for the stored asset. */
  mime?: string;
  ext?: string;
}

// Order = the order shown in the chooser (richest graphics first, text last).
const KINDS: KindSpec[] = [
  { kind: 'image', label: 'Image',
    types: ['public.png', 'image/png', 'public.jpeg', 'image/jpeg', 'public.jpg', 'public.tiff', 'image/tiff', 'image/gif', 'com.compuserve.gif', 'image/webp', 'org.webmproject.webp'],
    mime: 'image/png', ext: 'png' },
  { kind: 'svg', label: 'SVG',
    types: ['public.svg-image', 'com.microsoft.image-svg-xml', 'image/svg+xml'],
    mime: 'image/svg+xml', ext: 'svg' },
  { kind: 'pdf', label: 'PDF',
    types: ['com.adobe.pdf', 'application/pdf'],
    mime: 'application/pdf', ext: 'pdf' },
  // Synthesized (no raw clipboard type): rasterize the clipboard HTML to a
  // static PNG. Offered only when HTML *and* text are present — see
  // clipboardRepresentations. mime/ext are the captured output.
  { kind: 'html-image', label: 'Simple Image',
    types: [], mime: 'image/png', ext: 'png' },
  { kind: 'html', label: 'HTML element',
    types: ['public.html', 'text/html'] },
  { kind: 'text', label: 'Text',
    types: ['public.utf8-plain-text', 'public.text', 'text/plain', 'public.rtf', 'text/rtf'] },
];

const HTML_TYPES = ['public.html', 'text/html'];
const TEXT_TYPES = ['public.utf8-plain-text', 'public.text', 'text/plain', 'public.rtf', 'text/rtf'];

/** Which representations does this raw clipboard type/UTI list offer? PURE. */
export function clipboardRepresentations(types: readonly string[]): PasteRep[] {
  const set = new Set(types.map((t) => t.toLowerCase()));
  const has = (toks: string[]) => toks.some((t) => set.has(t.toLowerCase()));
  // "Simple Image" (rasterize the HTML) is offered only when BOTH HTML and text
  // are present — i.e. a rich copy (browser/Word/Docs) where rasterizing is a
  // meaningful alternative to pasting the text.
  const htmlImage = has(HTML_TYPES) && has(TEXT_TYPES);
  return KINDS
    .filter((k) => (k.kind === 'html-image' ? htmlImage : has(k.types)))
    .map((k) => ({ kind: k.kind, label: k.label }));
}

async function invokeSafe<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** Union of the native pasteboard UTIs (macOS) and the async Clipboard API MIME
 *  types (Linux/Windows). Used to build the chooser. */
export async function gatherClipboardTypes(): Promise<string[]> {
  const out = new Set<string>();
  const native = await invokeSafe<string[]>('pasteboard_list_types', {});
  native?.forEach((t) => out.add(t));
  if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      items.forEach((it) => it.types.forEach((t) => out.add(t)));
    } catch { /* permission / not focused */ }
  }
  return [...out];
}

async function readNativeBytes(uti: string): Promise<Uint8Array | null> {
  const arr = await invokeSafe<number[] | null>('pasteboard_read_type', { uti });
  return arr && arr.length ? new Uint8Array(arr) : null;
}

async function readAsyncBytes(mimes: string[]): Promise<Uint8Array | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      for (const m of mimes) {
        if (it.types.includes(m)) {
          const blob = await it.getType(m);
          return new Uint8Array(await blob.arrayBuffer());
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export interface RepData {
  kind: PasteKind;
  text?: string;
  html?: string;
  bytes?: Uint8Array;
  mime?: string;
  ext?: string;
}

/** Read the bytes/text for the chosen representation off the clipboard, native
 *  first (macOS) then the async Clipboard API. Returns null if it's gone. */
export async function readRepresentation(kind: PasteKind): Promise<RepData | null> {
  const spec = KINDS.find((k) => k.kind === kind);
  if (!spec) return null;

  if (kind === 'text') {
    const nb = await readNativeBytes('public.utf8-plain-text') ?? await readNativeBytes('public.text');
    if (nb) return { kind, text: new TextDecoder('utf-8').decode(nb) };
    try {
      const t = await navigator.clipboard?.readText?.();
      if (t) return { kind, text: t };
    } catch { /* ignore */ }
    return null;
  }

  if (kind === 'html' || kind === 'html-image') {
    // Both read the clipboard HTML; the caller rasterizes it for 'html-image'
    // and creates a raw HTML element for 'html'.
    const nb = await readNativeBytes('public.html');
    if (nb) return { kind, html: new TextDecoder('utf-8').decode(nb) };
    const ab = await readAsyncBytes(['text/html']);
    if (ab) return { kind, html: new TextDecoder('utf-8').decode(ab) };
    return null;
  }

  // image / svg / pdf → raw bytes
  for (const t of spec.types) {
    const nb = await readNativeBytes(t);
    if (nb) return { kind, bytes: nb, mime: spec.mime, ext: spec.ext };
  }
  const ab = await readAsyncBytes(spec.types);
  if (ab) return { kind, bytes: ab, mime: spec.mime, ext: spec.ext };
  return null;
}
