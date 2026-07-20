import { describe, it, expect } from 'vitest';
import corpus from '../../e2e/fixtures/clipboard-corpus/corpus.json';
import { decodeClipHtml } from './clipboardModel';
import { htmlNeedsScreenshot, extractPastedDataUrlImage } from './htmlPasteCapture';
import { pasteTextToElementHtml } from './pasteText';

// Interop: given what a real app puts on the clipboard (e2e/fixtures/clipboard-
// corpus/corpus.json), the paste ladder must land in the right branch. This
// mirrors SlideEditor.handlePaste's decision order — KEEP IN SYNC with it. The
// value is proving each foreign payload (Word/Docs/Slides/Sheets/Keynote/…)
// classifies correctly, catching regressions like #158 (Slides data-URL image)
// and #161 (Word <p> sentence must be text, not a screenshot).

type Branch = 'internal' | 'image-dataurl' | 'image-screenshot' | 'text';

/** Pure re-statement of the SlideEditor paste ladder over (html, plain). */
function classify(html: string, plain: string): Branch {
  if (decodeClipHtml(html)) return 'internal';
  if (extractPastedDataUrlImage(html)) return 'image-dataurl';
  if (htmlNeedsScreenshot(html)) return 'image-screenshot';
  if (pasteTextToElementHtml(html, plain) != null) return 'text';
  return 'text'; // empty clipboard falls through to a no-op; never reached in the corpus
}

describe('clipboard interop corpus — each app lands in the right paste branch', () => {
  it.each(corpus.cases.map((c) => [c.app, c] as const))('%s', (_app, c) => {
    expect(classify(c.html, c.plain)).toBe(c.expect);
  });

  it('covers the four branches (no branch left untested)', () => {
    const branches = new Set(corpus.cases.map((c) => c.expect));
    expect(branches).toEqual(new Set(['internal', 'image-dataurl', 'image-screenshot', 'text']));
  });

  it('every foreign (non-internal) payload advertises public.html or public.utf8-plain-text', () => {
    for (const c of corpus.cases) {
      const usable = c.flavors.includes('public.html') || c.flavors.includes('public.utf8-plain-text');
      expect(usable, `${c.app} has no ingestible flavor`).toBe(true);
    }
  });
});
