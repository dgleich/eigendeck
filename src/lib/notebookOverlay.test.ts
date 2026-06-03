import { describe, it, expect } from 'vitest';
import {
  emptyOverlay, isOverlayEmpty, parseOverlay, serializeOverlay,
  mergeNotebook, notebookSourceSignature, overlaySourceChanged, type Overlay,
} from './notebookOverlay';
import type { Notebook } from './notebookFormat';

const nb: Notebook = {
  kernelspecName: 'python3', kernelDisplayName: 'Python 3', language: 'python',
  cells: [
    { kind: 'markdown', index: 0, source: '# Title' },
    { kind: 'code', index: 1, source: 'k = 5', executionCount: 1,
      outputs: [{ kind: 'stream', name: 'stdout', text: 'baked\n' }] },
    { kind: 'code', index: 2, source: 'print(k)', executionCount: 2, outputs: [] },
  ],
};

describe('recording parse/serialize', () => {
  it('round-trips', () => {
    const r: Overlay = {
      version: 1,
      cellEdits: { 1: 'k = 10' },
      cellOutputs: { 1: [{ kind: 'stream', name: 'stdout', text: 'live\n' }] },
      cellCounts: { 1: 7 },
      appendedCells: [{ id: 'a1', afterIndex: 2, cellType: 'code', source: 'k*2' }],
    };
    expect(parseOverlay(serializeOverlay(r))).toEqual(r);
  });

  it('tolerates garbage → empty', () => {
    expect(parseOverlay('not json')).toEqual(emptyOverlay());
    expect(parseOverlay('{"cellEdits": 42}')).toEqual(emptyOverlay());
  });

  it('isOverlayEmpty', () => {
    expect(isOverlayEmpty(emptyOverlay())).toBe(true);
    const r = emptyOverlay(); r.cellEdits[0] = 'x';
    expect(isOverlayEmpty(r)).toBe(false);
  });
});

describe('overlay source-change detection (wipe-during-edit guard)', () => {
  const sig = notebookSourceSignature(nb);

  it('same bytes re-parse to an identical signature', () => {
    // simulate useNotebook re-fetching the same .ipynb (incidental event)
    const reparsed: Notebook = JSON.parse(JSON.stringify(nb));
    expect(notebookSourceSignature(reparsed)).toBe(sig);
  });

  it('does NOT reset on first load (no previous signature)', () => {
    expect(overlaySourceChanged(null, 'el-1', sig)).toBe(false);
  });

  it('does NOT reset when the signature is unchanged (incidental event)', () => {
    expect(overlaySourceChanged({ id: 'el-1', sig }, 'el-1', sig)).toBe(false);
  });

  it('RESETS when the same element’s source genuinely changes (reload/restore)', () => {
    const changed = notebookSourceSignature({ ...nb, cells: nb.cells.slice(0, 1) });
    expect(overlaySourceChanged({ id: 'el-1', sig }, 'el-1', changed)).toBe(true);
  });

  it('does NOT reset when the component is reused for a DIFFERENT element', () => {
    const other = notebookSourceSignature({ ...nb, cells: [] });
    expect(overlaySourceChanged({ id: 'el-1', sig }, 'el-2', other)).toBe(false);
  });
});

describe('mergeNotebook', () => {
  it('pristine notebook with empty recording = baked state', () => {
    const merged = mergeNotebook(nb, emptyOverlay());
    expect(merged).toHaveLength(3);
    const code1 = merged[1];
    expect(code1.origin).toBe('ipynb');
    if (code1.origin === 'ipynb') {
      expect(code1.source).toBe('k = 5');
      expect(code1.edited).toBe(false);
      expect(code1.outputRecorded).toBe(false);
      expect(code1.outputs).toHaveLength(1); // baked-in
    }
  });

  it('source edit overrides + flags edited', () => {
    const r = emptyOverlay(); r.cellEdits[1] = 'k = 10';
    const merged = mergeNotebook(nb, r);
    const c = merged[1];
    expect(c.origin).toBe('ipynb');
    if (c.origin === 'ipynb') {
      expect(c.source).toBe('k = 10');
      expect(c.edited).toBe(true);
    }
  });

  it('edit equal to source is not flagged edited', () => {
    const r = emptyOverlay(); r.cellEdits[1] = 'k = 5';
    const merged = mergeNotebook(nb, r);
    const c = merged[1];
    if (c.origin === 'ipynb') expect(c.edited).toBe(false);
  });

  it('recorded output takes precedence over baked-in', () => {
    const r = emptyOverlay();
    r.cellOutputs[1] = [{ kind: 'stream', name: 'stdout', text: 'live\n' }];
    r.cellCounts[1] = 9;
    const merged = mergeNotebook(nb, r);
    const c = merged[1];
    if (c.origin === 'ipynb') {
      expect(c.outputRecorded).toBe(true);
      expect(c.executionCount).toBe(9);
      expect((c.outputs[0] as { text: string }).text).toBe('live\n');
    }
  });

  it('appended cell splices after its anchor index', () => {
    const r = emptyOverlay();
    r.appendedCells = [{ id: 'a1', afterIndex: 1, cellType: 'code', source: 'extra' }];
    const merged = mergeNotebook(nb, r);
    // order: md(0), code(1), APPENDED, code(2)
    expect(merged).toHaveLength(4);
    expect(merged[2].origin).toBe('appended');
    if (merged[2].origin === 'appended') expect(merged[2].appended.source).toBe('extra');
    expect(merged[3].origin).toBe('ipynb');
  });

  it('appended cell anchored to top (null) renders first', () => {
    const r = emptyOverlay();
    r.appendedCells = [{ id: 'a0', afterIndex: null, cellType: 'markdown', source: 'intro' }];
    const merged = mergeNotebook(nb, r);
    expect(merged[0].origin).toBe('appended');
  });

  it('handles null notebook (only appended cells)', () => {
    const r = emptyOverlay();
    r.appendedCells = [{ id: 'a', afterIndex: null, cellType: 'code', source: 'x = 1' }];
    const merged = mergeNotebook(null, r);
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe('appended');
  });
});
