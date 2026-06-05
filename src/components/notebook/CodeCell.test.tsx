import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeCell } from './CodeCell';
import type { CodeCell as CodeCellT } from '../../lib/notebookFormat';

const cell: CodeCellT = {
  kind: 'code', index: 0, source: 'print(1)', executionCount: 1, outputs: [],
};

// editable=false avoids mounting the CodeMirror editor (jsdom-friendly).

describe('CodeCell visual distinction', () => {
  it('pristine cell has no edited/added marker or tag', () => {
    const { container } = render(<CodeCell cell={cell} highlight={false} />);
    const el = container.querySelector('.nb-cell-code')!;
    expect(el.classList.contains('nb-cell-edited')).toBe(false);
    expect(el.classList.contains('nb-cell-added')).toBe(false);
    expect(container.querySelector('.nb-cell-tag')).toBeNull();
  });

  it('edited cell gets the amber accent + revert affordance (no redundant tag)', () => {
    const onRevert = vi.fn();
    const { container } = render(
      <CodeCell cell={cell} highlight={false} edited onRevert={onRevert} />
    );
    expect(container.querySelector('.nb-cell-edited')).not.toBeNull();
    // The revert ⟲ button + amber accent indicate "edited" — no text tag.
    expect(container.querySelector('.nb-cell-tag')).toBeNull();
    expect(container.querySelector('.nb-cell-revert')).not.toBeNull();
    expect(container.querySelector('.nb-cell-delete')).toBeNull();
  });

  it('added cell gets teal "added" tag + delete affordance', () => {
    const onRevert = vi.fn();
    const { container } = render(
      <CodeCell cell={cell} highlight={false} added onRevert={onRevert} />
    );
    expect(container.querySelector('.nb-cell-added')).not.toBeNull();
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(container.querySelector('.nb-cell-delete')).not.toBeNull();
    expect(container.querySelector('.nb-cell-revert')).toBeNull();
  });

  it('renders the effective source (overlay) over the cell source', () => {
    render(<CodeCell cell={cell} source="print(999)" highlight={false} />);
    expect(screen.getByText('print(999)')).toBeInTheDocument();
  });

  it('Run button fires onRun', () => {
    const onRun = vi.fn();
    render(<CodeCell cell={cell} highlight={false} onRun={onRun} />);
    fireEvent.click(screen.getByTitle('Run this cell (Shift-Enter)'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('shows recorded outputs', () => {
    render(
      <CodeCell cell={cell} highlight={false}
        liveOutputs={[{ kind: 'stream', name: 'stdout', text: 'hello\n' }]} />
    );
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });
});
