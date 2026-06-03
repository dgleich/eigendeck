// Aggressive, adversarial coverage of notebookRecording.ts — the
// merge/overlay engine. The existing notebookRecording.test.ts holds a
// small happy-path suite; this file goes deep on parse robustness,
// merge precedence/ordering, and edge cases. Do not duplicate the
// existing tests.
//
// Where current behavior is arguably a bug or a gap, the test ASSERTS
// the current behavior (so the suite is green against the lib as it
// stands) and a sibling `it.skip` documents the DESIRED behavior with a
// TODO so the gap stays visible. Real bugs are recorded in
// .claude/notes/notebook-recording-test-plan.md, not hidden.

import { describe, it, expect } from 'vitest';
import {
  emptyRecording,
  isRecordingEmpty,
  parseRecording,
  serializeRecording,
  mergeNotebook,
  type Recording,
  type AppendedCell,
} from './notebookRecording';
import { parseNotebook } from './notebookParser';
import type { Notebook, CellOutput } from './notebookFormat';

// ---- shared fixtures ------------------------------------------------

/** A realistic notebook: markdown intro, two code cells (one with baked
 *  output), built through the REAL parser so indices/shapes match prod. */
function realNotebook(): Notebook {
  return parseNotebook(
    JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Title\n', 'intro'] },
        {
          cell_type: 'code',
          execution_count: 1,
          source: 'k = 5',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'baked\n' }],
        },
        { cell_type: 'code', execution_count: 2, source: 'print(k)', outputs: [] },
      ],
      metadata: {
        kernelspec: { name: 'python3', display_name: 'Python 3' },
        language_info: { name: 'python' },
      },
      nbformat: 4,
      nbformat_minor: 5,
    }),
  );
}

const streamOut = (text: string, name: 'stdout' | 'stderr' = 'stdout'): CellOutput => ({
  kind: 'stream',
  name,
  text,
});

// =====================================================================
// parseRecording
// =====================================================================

describe('parseRecording — happy paths & input forms', () => {
  it('parses a fully-populated recording from a string', () => {
    const r: Recording = {
      version: 1,
      cellEdits: { 1: 'k = 10' },
      cellOutputs: { 1: [streamOut('live\n')] },
      cellCounts: { 1: 7 },
      appendedCells: [{ id: 'a1', afterIndex: 2, cellType: 'code', source: 'k*2' }],
    };
    expect(parseRecording(serializeRecording(r))).toEqual(r);
  });

  it('parses from a Uint8Array', () => {
    const r = emptyRecording();
    r.cellEdits[3] = 'x';
    const bytes = new TextEncoder().encode(serializeRecording(r));
    expect(parseRecording(bytes)).toEqual(r);
  });

  it('parses from an ArrayBuffer', () => {
    const r = emptyRecording();
    r.cellEdits[3] = 'x';
    const u8 = new TextEncoder().encode(serializeRecording(r));
    // copy into a standalone ArrayBuffer to exercise the ArrayBuffer branch
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    expect(parseRecording(ab)).toEqual(r);
  });

  it('empty object → emptyRecording', () => {
    expect(parseRecording('{}')).toEqual(emptyRecording());
  });

  it('always normalizes version to literal 1, even if absent or wrong', () => {
    expect(parseRecording('{"version":99}').version).toBe(1);
    expect(parseRecording('{}').version).toBe(1);
    expect(parseRecording('{"version":"banana"}').version).toBe(1);
  });
});

describe('parseRecording — malformed / hostile input → empty', () => {
  it('not JSON at all', () => {
    expect(parseRecording('not json')).toEqual(emptyRecording());
  });

  it('truncated JSON', () => {
    expect(parseRecording('{"cellEdits": {')).toEqual(emptyRecording());
  });

  it('empty string', () => {
    expect(parseRecording('')).toEqual(emptyRecording());
  });

  it('JSON null → empty', () => {
    expect(parseRecording('null')).toEqual(emptyRecording());
  });

  it('JSON primitives (number/string/bool) → empty', () => {
    expect(parseRecording('42')).toEqual(emptyRecording());
    expect(parseRecording('"a string"')).toEqual(emptyRecording());
    expect(parseRecording('true')).toEqual(emptyRecording());
  });

  it('JSON array at top level → empty', () => {
    // arrays are typeof "object" but not a valid recording root.
    // numKeyed* iterate Object.entries(array) → numeric-string indices,
    // values are not strings/arrays-of-the-right-shape → all dropped.
    expect(parseRecording('[1,2,3]')).toEqual(emptyRecording());
  });
});

describe('parseRecording — wrong-typed top-level fields are coerced/dropped', () => {
  it('cellEdits as a number → {}', () => {
    expect(parseRecording('{"cellEdits": 42}').cellEdits).toEqual({});
  });

  it('cellEdits as an array → entries that happen to be strings survive (documents current behavior)', () => {
    // numKeyedStrings iterates Object.entries on the array: indices "0".."n"
    // are integers, and string values pass the typeof check. So a JSON array
    // of strings is silently reinterpreted as an index→string map.
    const r = parseRecording('{"cellEdits": ["a", "b"]}');
    expect(r.cellEdits).toEqual({ 0: 'a', 1: 'b' });
  });

  it('cellEdits as null → {}', () => {
    expect(parseRecording('{"cellEdits": null}').cellEdits).toEqual({});
  });

  it('cellOutputs not an array-of-arrays → non-array values dropped', () => {
    const r = parseRecording('{"cellOutputs": {"0": "nope", "1": [], "2": 5}}');
    expect(r.cellOutputs).toEqual({ 1: [] });
  });

  it('cellOutputs as a non-object → {}', () => {
    expect(parseRecording('{"cellOutputs": 7}').cellOutputs).toEqual({});
    expect(parseRecording('{"cellOutputs": "x"}').cellOutputs).toEqual({});
  });

  it('cellCounts accepts number and null, drops everything else', () => {
    const r = parseRecording('{"cellCounts": {"0": 3, "1": null, "2": "x", "3": [], "4": {}}}');
    expect(r.cellCounts).toEqual({ 0: 3, 1: null });
  });

  it('appendedCells not an array → []', () => {
    expect(parseRecording('{"appendedCells": {}}').appendedCells).toEqual([]);
    expect(parseRecording('{"appendedCells": 5}').appendedCells).toEqual([]);
    expect(parseRecording('{"appendedCells": null}').appendedCells).toEqual([]);
  });
});

describe('parseRecording — numeric key adversarial cases', () => {
  it('non-integer string keys are dropped', () => {
    const r = parseRecording('{"cellEdits": {"1.5": "a", "abc": "b", "x2": "c"}}');
    expect(r.cellEdits).toEqual({});
  });

  it('negative indices are KEPT (current behavior; merge never matches them)', () => {
    const r = parseRecording('{"cellEdits": {"-3": "neg"}}');
    expect(r.cellEdits).toEqual({ '-3': 'neg' });
  });

  it('huge indices are kept', () => {
    const r = parseRecording('{"cellEdits": {"999999": "big"}}');
    expect(r.cellEdits[999999]).toBe('big');
  });

  it('exponential-notation keys are coerced to integers (quirk: Number("1e3")===1000)', () => {
    const r = parseRecording('{"cellEdits": {"1e3": "thousand"}}');
    expect(r.cellEdits[1000]).toBe('thousand');
  });

  it('empty-string key is coerced to index 0 (quirk: Number("")===0)', () => {
    // Documents a sharp edge: an empty key silently becomes cell 0.
    const r = parseRecording('{"cellEdits": {"": "ghost"}}');
    expect(r.cellEdits[0]).toBe('ghost');
  });

  it('whitespace key " " coerces to 0 too (Number(" ")===0)', () => {
    const r = parseRecording('{"cellEdits": {" ": "ws"}}');
    expect(r.cellEdits[0]).toBe('ws');
  });

  it('NaN-producing key is dropped (Number("nope") is NaN, not integer)', () => {
    const r = parseRecording('{"cellEdits": {"nope": "x"}}');
    expect(r.cellEdits).toEqual({});
  });
});

describe('parseRecording — appendedCells validation', () => {
  it('drops appended cells missing required fields', () => {
    const json = JSON.stringify({
      appendedCells: [
        { id: 'ok', afterIndex: 0, cellType: 'code', source: 's' }, // valid
        { afterIndex: 0, cellType: 'code', source: 's' }, // no id
        { id: 'x', cellType: 'code', source: 's' }, // no afterIndex
        { id: 'x', afterIndex: 0, source: 's' }, // no cellType
        { id: 'x', afterIndex: 0, cellType: 'code' }, // no source
      ],
    });
    const r = parseRecording(json);
    expect(r.appendedCells).toHaveLength(1);
    expect(r.appendedCells[0].id).toBe('ok');
  });

  it('drops appended cells with wrong-typed required fields', () => {
    const json = JSON.stringify({
      appendedCells: [
        { id: 5, afterIndex: 0, cellType: 'code', source: 's' }, // id not string
        { id: 'x', afterIndex: '0', cellType: 'code', source: 's' }, // afterIndex string
        { id: 'x', afterIndex: 0, cellType: 'raw', source: 's' }, // bad cellType
        { id: 'x', afterIndex: 0, cellType: 'code', source: 5 }, // source not string
      ],
    });
    expect(parseRecording(json).appendedCells).toEqual([]);
  });

  it('accepts afterIndex null', () => {
    const json = JSON.stringify({
      appendedCells: [{ id: 'top', afterIndex: null, cellType: 'markdown', source: 's' }],
    });
    expect(parseRecording(json).appendedCells).toHaveLength(1);
  });

  it('keeps extra/unknown fields on appended cells (no whitelist)', () => {
    // isAppended only checks required fields; extras ride along untouched.
    const json = JSON.stringify({
      appendedCells: [
        { id: 'x', afterIndex: 0, cellType: 'code', source: 's', bogus: 'extra' },
      ],
    });
    const a = parseRecording(json).appendedCells[0] as AppendedCell & { bogus?: string };
    expect(a.bogus).toBe('extra');
  });

  it('preserves outputs/executionCount on appended cells WITHOUT validating their shape', () => {
    // isAppended does NOT validate outputs/executionCount; garbage rides through.
    const json = JSON.stringify({
      appendedCells: [
        {
          id: 'x',
          afterIndex: 0,
          cellType: 'code',
          source: 's',
          outputs: [{ kind: 'stream', name: 'stdout', text: 'hi' }],
          executionCount: 4,
        },
        {
          id: 'y',
          afterIndex: 0,
          cellType: 'code',
          source: 's',
          outputs: 'not-an-array', // garbage, but still passes isAppended
          executionCount: 'also-garbage',
        },
      ],
    });
    const cells = parseRecording(json).appendedCells;
    expect(cells).toHaveLength(2);
    expect(cells[0].outputs).toEqual([streamOut('hi')]);
    expect(cells[0].executionCount).toBe(4);
    // documents the gap: malformed outputs survive parsing
    expect((cells[1] as unknown as { outputs: unknown }).outputs).toBe('not-an-array');
  });

  it('appendedCells entries that are primitives/null are dropped', () => {
    const json = JSON.stringify({ appendedCells: [null, 5, 'str', true, []] });
    expect(parseRecording(json).appendedCells).toEqual([]);
  });
});

describe('parseRecording — unicode & large payloads', () => {
  it('preserves unicode (emoji, CJK, combining marks, RTL) in source', () => {
    const src = 'x = "héllo 世界 👩‍🔬 ́ مرحبا"';
    const r = emptyRecording();
    r.cellEdits[0] = src;
    const out = parseRecording(serializeRecording(r));
    expect(out.cellEdits[0]).toBe(src);
  });

  it('preserves unicode through a raw Uint8Array round-trip', () => {
    const src = '∑ λ→μ ✓ 🚀';
    const r = emptyRecording();
    r.appendedCells = [{ id: 'u', afterIndex: null, cellType: 'markdown', source: src }];
    const bytes = new TextEncoder().encode(serializeRecording(r));
    expect(parseRecording(bytes).appendedCells[0].source).toBe(src);
  });

  it('handles a very large base64-ish output payload', () => {
    const bigB64 = 'A'.repeat(2_000_000); // ~2 MB simulated PNG
    const r = emptyRecording();
    r.cellOutputs[0] = [{ kind: 'display_data', data: { 'image/png': bigB64 } }];
    const parsed = parseRecording(serializeRecording(r));
    const out = parsed.cellOutputs[0][0];
    expect(out.kind).toBe('display_data');
    if (out.kind === 'display_data') {
      expect((out.data['image/png'] as string).length).toBe(2_000_000);
    }
  });
});

describe('parseRecording — round-trip stability (deep equality)', () => {
  it('parse(serialize(x)) deep-equals x for a rich recording incl. every output kind', () => {
    const rich: Recording = {
      version: 1,
      cellEdits: { 0: '# md edit', 2: 'print("x")', 5: '' },
      cellOutputs: {
        1: [
          streamOut('out\n'),
          streamOut('err\n', 'stderr'),
          { kind: 'display_data', data: { 'text/plain': 'repr', 'image/png': 'b64==' } },
          { kind: 'execute_result', data: { 'text/plain': '42' }, executionCount: 3 },
          { kind: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['line1', 'line2'] },
        ],
        2: [],
      },
      cellCounts: { 1: 3, 2: null },
      appendedCells: [
        { id: 'a', afterIndex: null, cellType: 'markdown', source: 'intro' },
        {
          id: 'b',
          afterIndex: 2,
          cellType: 'code',
          source: 'live()',
          outputs: [streamOut('appended out\n')],
          executionCount: 11,
        },
      ],
    };
    expect(parseRecording(serializeRecording(rich))).toEqual(rich);
  });

  it('is idempotent across two serialize/parse cycles', () => {
    const r: Recording = {
      version: 1,
      cellEdits: { 4: 'a' },
      cellOutputs: { 4: [streamOut('z')] },
      cellCounts: { 4: 1 },
      appendedCells: [{ id: 'x', afterIndex: 4, cellType: 'code', source: 's' }],
    };
    const once = parseRecording(serializeRecording(r));
    const twice = parseRecording(serializeRecording(once));
    expect(twice).toEqual(once);
    expect(twice).toEqual(r);
  });

  it('null executionCount survives the round-trip (not dropped, not coerced to undefined)', () => {
    const r = emptyRecording();
    r.cellOutputs[0] = [];
    r.cellCounts[0] = null;
    const out = parseRecording(serializeRecording(r));
    expect(out.cellCounts).toHaveProperty('0', null);
  });
});

// =====================================================================
// isRecordingEmpty
// =====================================================================

describe('isRecordingEmpty', () => {
  it('true for a fresh emptyRecording', () => {
    expect(isRecordingEmpty(emptyRecording())).toBe(true);
  });

  it('false when ANY single sub-collection is non-empty', () => {
    const e1 = emptyRecording(); e1.cellEdits[0] = 'x';
    const e2 = emptyRecording(); e2.cellOutputs[0] = [];
    const e3 = emptyRecording(); e3.cellCounts[0] = null;
    const e4 = emptyRecording(); e4.appendedCells.push({ id: 'a', afterIndex: null, cellType: 'code', source: '' });
    expect(isRecordingEmpty(e1)).toBe(false);
    expect(isRecordingEmpty(e2)).toBe(false); // even an empty outputs array counts as non-empty
    expect(isRecordingEmpty(e3)).toBe(false); // even a null count counts as non-empty
    expect(isRecordingEmpty(e4)).toBe(false);
  });

  it('a recorded-but-empty output array marks the recording non-empty', () => {
    // This matters: "ran a cell that produced nothing" is still a recording.
    const r = emptyRecording();
    r.cellOutputs[2] = [];
    expect(isRecordingEmpty(r)).toBe(false);
  });
});

// =====================================================================
// mergeNotebook — precedence
// =====================================================================

describe('mergeNotebook — source precedence', () => {
  it('cellEdits override baked source; flags edited=true', () => {
    const r = emptyRecording();
    r.cellEdits[1] = 'k = 99';
    const m = mergeNotebook(realNotebook(), r)[1];
    expect(m.origin).toBe('ipynb');
    if (m.origin === 'ipynb') {
      expect(m.source).toBe('k = 99');
      expect(m.edited).toBe(true);
    }
  });

  it('edit byte-identical to baked source is NOT flagged edited', () => {
    const r = emptyRecording();
    r.cellEdits[1] = 'k = 5';
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.source).toBe('k = 5');
      expect(m.edited).toBe(false);
    }
  });

  it('an empty-string edit overriding non-empty source IS an edit', () => {
    const r = emptyRecording();
    r.cellEdits[1] = '';
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.source).toBe('');
      expect(m.edited).toBe(true);
    }
  });

  it('edits apply to markdown cells (source overridden, no outputs)', () => {
    const r = emptyRecording();
    r.cellEdits[0] = '# New Title';
    const m = mergeNotebook(realNotebook(), r)[0];
    if (m.origin === 'ipynb') {
      expect(m.cell.kind).toBe('markdown');
      expect(m.source).toBe('# New Title');
      expect(m.edited).toBe(true);
      expect(m.outputs).toEqual([]);
      expect(m.outputRecorded).toBe(false);
    }
  });

  it('edits apply to raw cells', () => {
    const nb = parseNotebook(
      JSON.stringify({ cells: [{ cell_type: 'raw', source: 'raw body' }], metadata: {} }),
    );
    const r = emptyRecording();
    r.cellEdits[0] = 'edited raw';
    const m = mergeNotebook(nb, r)[0];
    if (m.origin === 'ipynb') {
      expect(m.cell.kind).toBe('raw');
      expect(m.source).toBe('edited raw');
      expect(m.edited).toBe(true);
    }
  });
});

describe('mergeNotebook — output precedence', () => {
  it('recorded output wins over baked-in output', () => {
    const r = emptyRecording();
    r.cellOutputs[1] = [streamOut('live\n')];
    r.cellCounts[1] = 9;
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.outputRecorded).toBe(true);
      expect(m.outputs).toEqual([streamOut('live\n')]);
      expect(m.executionCount).toBe(9);
    }
  });

  it('a recorded EMPTY output array suppresses the baked-in output', () => {
    // recOut !== undefined, so the empty array wins → cell shows no output.
    const r = emptyRecording();
    r.cellOutputs[1] = [];
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.outputRecorded).toBe(true);
      expect(m.outputs).toEqual([]);
    }
  });

  it('no recorded output → baked-in output shown, outputRecorded=false', () => {
    const m = mergeNotebook(realNotebook(), emptyRecording())[1];
    if (m.origin === 'ipynb') {
      expect(m.outputRecorded).toBe(false);
      expect(m.outputs).toEqual([streamOut('baked\n')]);
      expect(m.executionCount).toBe(1); // baked execution count
    }
  });

  it('recorded output with no matching cellCounts entry → executionCount null', () => {
    const r = emptyRecording();
    r.cellOutputs[1] = [streamOut('x')];
    // no cellCounts[1]
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.outputRecorded).toBe(true);
      expect(m.executionCount).toBe(null);
    }
  });

  it('recorded output with explicit null count → executionCount null (not baked count)', () => {
    const r = emptyRecording();
    r.cellOutputs[1] = [streamOut('x')];
    r.cellCounts[1] = null;
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') expect(m.executionCount).toBe(null);
  });

  it('cellCounts WITHOUT a recorded output is ignored (executionCount stays baked)', () => {
    // Guards the precedence: count only takes effect when outputRecorded.
    const r = emptyRecording();
    r.cellCounts[1] = 42;
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.outputRecorded).toBe(false);
      expect(m.executionCount).toBe(1); // baked, NOT 42
    }
  });

  it('markdown/raw cells never receive recorded outputs even if recording has them', () => {
    const r = emptyRecording();
    r.cellOutputs[0] = [streamOut('should be ignored')]; // index 0 is markdown
    r.cellCounts[0] = 5;
    const m = mergeNotebook(realNotebook(), r)[0];
    if (m.origin === 'ipynb') {
      expect(m.cell.kind).toBe('markdown');
      expect(m.outputs).toEqual([]);
      expect(m.outputRecorded).toBe(false);
      expect(m.executionCount).toBe(null);
    }
  });
});

describe('mergeNotebook — a cell present in BOTH cellEdits and cellOutputs', () => {
  it('applies the source edit AND the recorded output to the same cell', () => {
    const r = emptyRecording();
    r.cellEdits[1] = 'k = 123';
    r.cellOutputs[1] = [streamOut('recorded\n')];
    r.cellCounts[1] = 8;
    const m = mergeNotebook(realNotebook(), r)[1];
    if (m.origin === 'ipynb') {
      expect(m.source).toBe('k = 123');
      expect(m.edited).toBe(true);
      expect(m.outputs).toEqual([streamOut('recorded\n')]);
      expect(m.outputRecorded).toBe(true);
      expect(m.executionCount).toBe(8);
    }
  });
});

// =====================================================================
// mergeNotebook — origin/flags correctness on EVERY cell
// =====================================================================

describe('mergeNotebook — every MergedCell has coherent origin/flags', () => {
  it('pristine notebook + empty recording: all ipynb, all flags false/baked', () => {
    const merged = mergeNotebook(realNotebook(), emptyRecording());
    expect(merged.map((c) => c.origin)).toEqual(['ipynb', 'ipynb', 'ipynb']);
    for (const c of merged) {
      if (c.origin === 'ipynb') {
        expect(c.edited).toBe(false);
        expect(c.outputRecorded).toBe(false);
      }
    }
  });

  it('appended cells carry only origin+appended (no edited/outputRecorded fields)', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'a', afterIndex: 1, cellType: 'code', source: 's' }];
    const merged = mergeNotebook(realNotebook(), r);
    const ap = merged.find((c) => c.origin === 'appended');
    expect(ap).toBeDefined();
    expect(ap).not.toHaveProperty('edited');
    expect(ap).not.toHaveProperty('outputRecorded');
    if (ap && ap.origin === 'appended') expect(ap.appended.id).toBe('a');
  });

  it('the MergedCell.cell reference points at the original parsed cell', () => {
    const nb = realNotebook();
    const merged = mergeNotebook(nb, emptyRecording());
    const c = merged[1];
    if (c.origin === 'ipynb') expect(c.cell).toBe(nb.cells[1]);
  });
});

// =====================================================================
// mergeNotebook — appended-cell ordering
// =====================================================================

describe('mergeNotebook — appended ordering', () => {
  it('multiple top-anchored (null) appended cells preserve array order', () => {
    const r = emptyRecording();
    r.appendedCells = [
      { id: 't1', afterIndex: null, cellType: 'code', source: '1' },
      { id: 't2', afterIndex: null, cellType: 'code', source: '2' },
      { id: 't3', afterIndex: null, cellType: 'code', source: '3' },
    ];
    const merged = mergeNotebook(realNotebook(), r);
    expect(merged.slice(0, 3).map((c) => (c.origin === 'appended' ? c.appended.id : null))).toEqual([
      't1', 't2', 't3',
    ]);
    // followed by the three ipynb cells
    expect(merged.slice(3).map((c) => c.origin)).toEqual(['ipynb', 'ipynb', 'ipynb']);
  });

  it('multiple cells anchored to the SAME real index preserve array order', () => {
    const r = emptyRecording();
    r.appendedCells = [
      { id: 'x1', afterIndex: 1, cellType: 'code', source: 'a' },
      { id: 'x2', afterIndex: 1, cellType: 'code', source: 'b' },
    ];
    const merged = mergeNotebook(realNotebook(), r);
    // md(0), code(1), x1, x2, code(2)
    expect(merged.map((c) => (c.origin === 'appended' ? c.appended.id : c.origin))).toEqual([
      'ipynb', 'ipynb', 'x1', 'x2', 'ipynb',
    ]);
  });

  it('appended after the LAST index renders at the very end', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'tail', afterIndex: 2, cellType: 'code', source: 's' }];
    const merged = mergeNotebook(realNotebook(), r);
    expect(merged).toHaveLength(4);
    const last = merged[3];
    expect(last.origin).toBe('appended');
    if (last.origin === 'appended') expect(last.appended.id).toBe('tail');
  });

  it('appended interleaved with edits: anchors are by ORIGINAL index, edits do not shift anchors', () => {
    const r = emptyRecording();
    r.cellEdits[1] = 'k = edited';
    r.appendedCells = [
      { id: 'after0', afterIndex: 0, cellType: 'markdown', source: 'A' },
      { id: 'after1', afterIndex: 1, cellType: 'code', source: 'B' },
    ];
    const merged = mergeNotebook(realNotebook(), r);
    // md(0), after0, code(1 edited), after1, code(2)
    const shape = merged.map((c) => (c.origin === 'appended' ? c.appended.id : `ipynb:${(c as { cell: { index: number } }).cell.index}`));
    expect(shape).toEqual(['ipynb:0', 'after0', 'ipynb:1', 'after1', 'ipynb:2']);
    const edited = merged[2];
    if (edited.origin === 'ipynb') expect(edited.source).toBe('k = edited');
  });

  it('top-anchored + index-anchored together: top first, then per-anchor', () => {
    const r = emptyRecording();
    r.appendedCells = [
      { id: 'idx0', afterIndex: 0, cellType: 'code', source: 'i' },
      { id: 'top', afterIndex: null, cellType: 'code', source: 't' },
    ];
    const merged = mergeNotebook(realNotebook(), r);
    // top renders before everything (it's collected from the null bucket first),
    // idx0 renders after cell 0 — regardless of appendedCells array order.
    const shape = merged.map((c) => (c.origin === 'appended' ? c.appended.id : 'ipynb'));
    expect(shape).toEqual(['top', 'ipynb', 'idx0', 'ipynb', 'ipynb']);
  });
});

// =====================================================================
// mergeNotebook — orphan anchors (the documented GAP)
// =====================================================================

describe('mergeNotebook — orphan anchors (appended anchored to a missing index)', () => {
  it('CURRENT BEHAVIOR: an appended cell anchored to a nonexistent index vanishes', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'orphan', afterIndex: 99, cellType: 'code', source: 'lost' }];
    const merged = mergeNotebook(realNotebook(), r);
    // only the 3 ipynb cells; the orphan is silently dropped.
    expect(merged).toHaveLength(3);
    expect(merged.some((c) => c.origin === 'appended')).toBe(false);
  });

  it('CURRENT BEHAVIOR: negative-anchor appended cell vanishes (not treated as top)', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'neg', afterIndex: -1, cellType: 'code', source: 'lost' }];
    const merged = mergeNotebook(realNotebook(), r);
    expect(merged.some((c) => c.origin === 'appended')).toBe(false);
  });

  // DESIRED behavior per the plan: orphaned appended cells should still be
  // emitted (e.g. flushed to the tail with a "detached" marker) so the
  // user never silently loses live-authored content when the .ipynb shrinks.
  // See notebook-recording-test-plan.md → P5 "index-drift".
  it.skip('DESIRED: orphaned appended cells are emitted at the tail as detached (TODO: implement tail-emit + detached flag)', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'orphan', afterIndex: 99, cellType: 'code', source: 'lost' }];
    const merged = mergeNotebook(realNotebook(), r);
    const orphan = merged.find((c) => c.origin === 'appended' && c.appended.id === 'orphan');
    expect(orphan).toBeDefined();
    // expected future shape: a `detached: true` flag on the merged appended cell.
    // expect((orphan as { detached?: boolean }).detached).toBe(true);
  });
});

// =====================================================================
// mergeNotebook — degenerate notebooks
// =====================================================================

describe('mergeNotebook — degenerate / empty notebooks', () => {
  it('null notebook + empty recording → []', () => {
    expect(mergeNotebook(null, emptyRecording())).toEqual([]);
  });

  it('null notebook + only top-anchored appended → just those, in order', () => {
    const r = emptyRecording();
    r.appendedCells = [
      { id: 'a', afterIndex: null, cellType: 'code', source: '1' },
      { id: 'b', afterIndex: null, cellType: 'markdown', source: '2' },
    ];
    const merged = mergeNotebook(null, r);
    expect(merged.map((c) => (c.origin === 'appended' ? c.appended.id : null))).toEqual(['a', 'b']);
  });

  it('null notebook + index-anchored appended → those orphans vanish (no cells to anchor to)', () => {
    const r = emptyRecording();
    r.appendedCells = [{ id: 'x', afterIndex: 0, cellType: 'code', source: 's' }];
    expect(mergeNotebook(null, r)).toEqual([]);
  });

  it('empty notebook (cells:[]) + top-anchored appended → just the appended', () => {
    const nb = parseNotebook(JSON.stringify({ cells: [], metadata: {} }));
    const r = emptyRecording();
    r.appendedCells = [{ id: 'a', afterIndex: null, cellType: 'code', source: 's' }];
    const merged = mergeNotebook(nb, r);
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe('appended');
  });

  it('notebook with ONLY markdown cells: edits apply, no cell ever gets outputs', () => {
    const nb = parseNotebook(
      JSON.stringify({
        cells: [
          { cell_type: 'markdown', source: '# A' },
          { cell_type: 'markdown', source: '# B' },
        ],
        metadata: {},
      }),
    );
    const r = emptyRecording();
    r.cellEdits[1] = '# B edited';
    r.cellOutputs[0] = [streamOut('ignored')];
    const merged = mergeNotebook(nb, r);
    expect(merged).toHaveLength(2);
    for (const c of merged) {
      if (c.origin === 'ipynb') {
        expect(c.outputs).toEqual([]);
        expect(c.outputRecorded).toBe(false);
      }
    }
    if (merged[1].origin === 'ipynb') {
      expect(merged[1].source).toBe('# B edited');
      expect(merged[1].edited).toBe(true);
    }
  });
});

describe('mergeNotebook — recording references beyond notebook length', () => {
  it('cellEdits/cellOutputs/cellCounts for out-of-range indices are simply never applied', () => {
    const r = emptyRecording();
    r.cellEdits[50] = 'never';
    r.cellOutputs[50] = [streamOut('never')];
    r.cellCounts[50] = 5;
    const baseline = mergeNotebook(realNotebook(), emptyRecording());
    const merged = mergeNotebook(realNotebook(), r);
    // identical render list to the empty-recording baseline (cells unchanged)
    expect(merged.map((c) => (c.origin === 'ipynb' ? c.source : null))).toEqual(
      baseline.map((c) => (c.origin === 'ipynb' ? c.source : null)),
    );
    expect(merged.every((c) => c.origin === 'ipynb' && !c.edited && !c.outputRecorded)).toBe(true);
  });

  it('a negative-index edit is parsed but never matched by merge', () => {
    const r = parseRecording('{"cellEdits": {"-1": "neg"}}');
    const merged = mergeNotebook(realNotebook(), r);
    expect(merged.every((c) => c.origin === 'ipynb' && !c.edited)).toBe(true);
  });
});

// =====================================================================
// integration-ish: parsed recording → merge (no hand-built Recording)
// =====================================================================

describe('parseRecording → mergeNotebook end to end', () => {
  it('a recording loaded from bytes merges identically to its in-memory twin', () => {
    const r: Recording = {
      version: 1,
      cellEdits: { 1: 'k = 7' },
      cellOutputs: { 2: [streamOut('printed 7\n')] },
      cellCounts: { 2: 4 },
      appendedCells: [{ id: 'live', afterIndex: 2, cellType: 'code', source: 'k+1' }],
    };
    const bytes = new TextEncoder().encode(serializeRecording(r));
    const fromBytes = mergeNotebook(realNotebook(), parseRecording(bytes));
    const fromMem = mergeNotebook(realNotebook(), r);
    expect(fromBytes).toEqual(fromMem);
  });
});
