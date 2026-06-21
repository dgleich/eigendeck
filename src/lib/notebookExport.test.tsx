// Static notebook HTML export — renderNotebookElementHtml emits the
// markdown text, the code source, and recorded outputs, and contains NO
// run button / editor (read-only export path through <NotebookCells>
// with no `live` controller).

import { describe, it, expect } from 'vitest';
import { renderNotebookElementHtml } from './notebookExport';
import type { NotebookElement, Slide, Presentation } from '../types/presentation';

const MARKDOWN_TEXT = 'Hello from the markdown cell';
const CODE_SOURCE = 'print("eigendeck-code-source")';
const OUTPUT_TEXT = 'eigendeck-recorded-output';

/** A minimal .ipynb: one markdown cell, one code cell with a baked-in
 *  stream output. */
const IPYNB = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' },
    language_info: { name: 'python' } },
  cells: [
    { cell_type: 'markdown', source: [MARKDOWN_TEXT] },
    {
      cell_type: 'code',
      execution_count: 7,
      source: [CODE_SOURCE],
      outputs: [
        { output_type: 'stream', name: 'stdout', text: [OUTPUT_TEXT] },
      ],
    },
  ],
});

const ELEMENT: NotebookElement = {
  id: 'el-nb-1',
  type: 'notebook',
  assetId: 'a-nb-1',
  position: { x: 0, y: 0, width: 800, height: 600 },
};

const SLIDE: Slide = { id: 's1', elements: [ELEMENT], notes: '' } as unknown as Slide;

const PRESENTATION: Presentation = {
  title: 'T', theme: 'white',
  slides: [SLIDE],
  config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
} as unknown as Presentation;

/** Fake asset resolver: the .ipynb by id; any overlay lookup throws (no
 *  recorded session) → empty overlay. */
async function getAssetBytes(assetId: string): Promise<Uint8Array> {
  if (assetId === 'a-nb-1') return new TextEncoder().encode(IPYNB);
  throw new Error(`no asset ${assetId}`);
}

describe('renderNotebookElementHtml', () => {
  it('emits markdown text, code source, and recorded output', async () => {
    const html = await renderNotebookElementHtml(ELEMENT, SLIDE, PRESENTATION, getAssetBytes);
    expect(html).toContain(MARKDOWN_TEXT);
    // The code source appears (possibly inside highlight spans); the
    // distinctive token is enough.
    expect(html).toContain('eigendeck-code-source');
    expect(html).toContain(OUTPUT_TEXT);
  });

  it('is read-only: no run button and no editor', async () => {
    const html = await renderNotebookElementHtml(ELEMENT, SLIDE, PRESENTATION, getAssetBytes);
    // The .nb-cell-run / .nb-add-cell strings appear in the inlined
    // stylesheet, so assert on the ELEMENT markup (class="…" — escaped in
    // the srcdoc to class=&quot;…) rather than the bare class name.
    expect(html).not.toContain('class=&quot;nb-cell-run');
    expect(html).not.toContain('class=&quot;nb-add-cell');
    // The CodeMirror editor host class only renders when editable.
    expect(html).not.toContain('class=&quot;nb-cell-source nb-cell-source-editing');
  });

  it('wraps the cells in a scrollable srcdoc iframe', async () => {
    const html = await renderNotebookElementHtml(ELEMENT, SLIDE, PRESENTATION, getAssetBytes);
    expect(html).toContain('<iframe');
    expect(html).toContain('srcdoc=');
    // notebook.css inlined → the scoped .nb-body overflow rule travels with it.
    expect(html).toContain('nb-body');
  });
});

// --- option permutations ---------------------------------------------------
//
// Every display option a notebook element exposes must take effect in the
// export. The builder output is an escaped `srcdoc`, and the inlined
// notebook.css also CONTAINS these class names as selectors — so we extract
// the srcdoc, unescape it, and assert on the BODY markup only (after the
// </style></head>), never the stylesheet.

/** Reverse exportCore/notebookExport's srcdoc attribute escaping. */
function unescapeSrcdoc(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last, mirroring the escape order
}

/** The notebook's BODY markup (cells/frame), with the inlined <style>
 *  stripped, so class-name assertions can't false-positive on CSS rules. */
function exportBody(html: string): string {
  const m = html.match(/srcdoc="([^"]*)"/);
  if (!m) throw new Error('no srcdoc in export output');
  const doc = unescapeSrcdoc(m[1]);
  const marker = '</head><body>';
  const i = doc.indexOf(marker);
  return i >= 0 ? doc.slice(i + marker.length) : doc;
}

/** A 2-line code cell so line numbers are meaningful, + a markdown cell. */
const MULTILINE_IPYNB = JSON.stringify({
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' },
    language_info: { name: 'python' } },
  cells: [
    { cell_type: 'markdown', source: [MARKDOWN_TEXT] },
    { cell_type: 'code', execution_count: 1, source: ['x = 1\n', 'print(x)'], outputs: [] },
  ],
});

async function getMultilineBytes(assetId: string): Promise<Uint8Array> {
  if (assetId === 'a-nb-1') return new TextEncoder().encode(MULTILINE_IPYNB);
  throw new Error(`no asset ${assetId}`);
}

async function renderWith(opts: Partial<NotebookElement>): Promise<string> {
  const el = { ...ELEMENT, ...opts } as NotebookElement;
  const slide = { id: 's1', elements: [el], notes: '' } as unknown as Slide;
  const html = await renderNotebookElementHtml(el, slide, PRESENTATION, getMultilineBytes);
  return exportBody(html);
}

describe('renderNotebookElementHtml — option permutations', () => {
  const bools = [true, false];

  // Full cross product of the three boolean display options. Each option's
  // effect is asserted independently in every combination, so e.g. line
  // numbers must work whether or not the header is shown or code highlighted.
  for (const hideHeader of bools) {
    for (const showLineNumbers of bools) {
      for (const syntaxHighlight of bools) {
        const name = `hideHeader=${hideHeader} showLineNumbers=${showLineNumbers} syntaxHighlight=${syntaxHighlight}`;
        it(name, async () => {
          const body = await renderWith({ hideHeader, showLineNumbers, syntaxHighlight });

          // Header: present iff not hidden.
          expect(body.includes('class="nb-header"'), `header ${name}`).toBe(!hideHeader);
          expect(body.includes('class="nb-kernel-label"')).toBe(!hideHeader);

          // Line numbers: the <pre> gains nb-has-linenos + an nb-linenos span.
          expect(body.includes('nb-has-linenos'), `linenos ${name}`).toBe(showLineNumbers);
          expect(body.includes('class="nb-linenos"')).toBe(showLineNumbers);

          // Syntax highlight: highlighted code renders <code class="hljs">,
          // otherwise a plain <code>.
          expect(body.includes('class="hljs"'), `highlight ${name}`).toBe(syntaxHighlight);

          // The code source is present regardless of any option.
          expect(body).toContain('print');
        });
      }
    }
  }

  it('line numbers count matches the code cell line count', async () => {
    const body = await renderWith({ showLineNumbers: true });
    // The 2-line cell ("x = 1" / "print(x)") → an nb-linenos span "1\n2".
    const m = body.match(/<span class="nb-linenos"[^>]*>([\s\S]*?)<\/span>/);
    expect(m, 'nb-linenos span present').toBeTruthy();
    expect(m![1].trim().split('\n').map((s) => s.trim())).toEqual(['1', '2']);
  });

  it('showBorder toggles the nb-frame--bordered class', async () => {
    expect(await renderWith({ showBorder: true })).toContain('nb-frame--bordered');
    expect(await renderWith({ showBorder: false })).not.toContain('nb-frame--bordered');
  });

  it('hideMarkdown drops markdown cells but keeps code', async () => {
    const hidden = await renderWith({ hideMarkdown: true });
    expect(hidden).not.toContain(MARKDOWN_TEXT);
    expect(hidden).toContain('print');
    const shown = await renderWith({ hideMarkdown: false });
    expect(shown).toContain(MARKDOWN_TEXT);
  });

  it('visibleCells whitelist renders only the listed cells', async () => {
    // Keep only the code cell (index 1) → markdown (index 0) is excluded.
    const body = await renderWith({ visibleCells: [1] });
    expect(body).not.toContain(MARKDOWN_TEXT);
    expect(body).toContain('print');
  });

  it('dark theme adds nb-theme-dark (light adds nb-theme-light)', async () => {
    const darkSlide = { id: 's1', elements: [ELEMENT], notes: '', theme: 'dark' } as unknown as Slide;
    const darkHtml = await renderNotebookElementHtml(
      { ...ELEMENT } as NotebookElement, darkSlide,
      { ...PRESENTATION, theme: 'dark' } as Presentation, getMultilineBytes);
    expect(exportBody(darkHtml)).toContain('nb-theme-dark');
    expect(await renderWith({})).toContain('nb-theme-light');
  });
});
