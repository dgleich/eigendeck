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
