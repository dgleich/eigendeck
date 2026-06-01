import { describe, it, expect } from 'vitest';
import { parseNotebook } from './notebookParser';

const minimalIpynb = {
  cells: [
    { cell_type: 'markdown', source: '# Title\n\nSome *text*.' },
    { cell_type: 'code', source: 'print("hi")', execution_count: 1,
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }] },
    { cell_type: 'code', source: ['import numpy\n', 'numpy.zeros(3)'],
      execution_count: 2,
      outputs: [{
        output_type: 'execute_result',
        execution_count: 2,
        data: { 'text/plain': 'array([0., 0., 0.])' },
      }] },
    { cell_type: 'code', source: '1/0', execution_count: 3,
      outputs: [{
        output_type: 'error',
        ename: 'ZeroDivisionError', evalue: 'division by zero',
        traceback: ['Traceback...', 'ZeroDivisionError: division by zero'],
      }] },
    { cell_type: 'raw', source: 'not code, not md' },
  ],
  metadata: {
    kernelspec: { name: 'python3', display_name: 'Python 3' },
    language_info: { name: 'python' },
  },
};

describe('parseNotebook', () => {
  it('parses cells of each kind', () => {
    const nb = parseNotebook(minimalIpynb);
    expect(nb.cells).toHaveLength(5);
    expect(nb.cells[0].kind).toBe('markdown');
    expect(nb.cells[1].kind).toBe('code');
    expect(nb.cells[4].kind).toBe('raw');
  });

  it('joins multiline source arrays', () => {
    const nb = parseNotebook(minimalIpynb);
    expect((nb.cells[2] as { source: string }).source).toBe('import numpy\nnumpy.zeros(3)');
  });

  it('extracts kernelspec and language metadata', () => {
    const nb = parseNotebook(minimalIpynb);
    expect(nb.kernelspecName).toBe('python3');
    expect(nb.kernelDisplayName).toBe('Python 3');
    expect(nb.language).toBe('python');
  });

  it('infers language from kernelspec when language_info absent', () => {
    const nb = parseNotebook({
      cells: [],
      metadata: { kernelspec: { name: 'julia-1.10', display_name: 'Julia 1.10' } },
    });
    expect(nb.language).toBe('julia');
  });

  it('returns empty notebook for malformed top-level', () => {
    const nb = parseNotebook({ cells: [] });
    expect(nb.cells).toHaveLength(0);
    expect(nb.kernelspecName).toBeNull();
  });

  it('parses each output type', () => {
    const nb = parseNotebook(minimalIpynb);
    const code = nb.cells.filter(c => c.kind === 'code') as { outputs: { kind: string }[] }[];
    expect(code[0].outputs[0].kind).toBe('stream');
    expect(code[1].outputs[0].kind).toBe('execute_result');
    expect(code[2].outputs[0].kind).toBe('error');
  });

  it('accepts string input (JSON parse)', () => {
    const nb = parseNotebook(JSON.stringify(minimalIpynb));
    expect(nb.cells).toHaveLength(5);
  });

  it('drops unknown cell types instead of throwing', () => {
    const nb = parseNotebook({
      cells: [
        { cell_type: 'unknown-future-type', source: 'x' },
        { cell_type: 'code', source: 'y', execution_count: 1, outputs: [] },
      ],
    });
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].kind).toBe('code');
  });
});
