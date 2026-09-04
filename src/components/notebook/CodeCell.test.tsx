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

  it('added cell gets the teal accent + delete affordance (no redundant tag)', () => {
    const onRevert = vi.fn();
    const { container } = render(
      <CodeCell cell={cell} highlight={false} added onRevert={onRevert} />
    );
    expect(container.querySelector('.nb-cell-added')).not.toBeNull();
    // The ✕ delete button + teal accent indicate "added" — no text tag.
    expect(container.querySelector('.nb-cell-tag')).toBeNull();
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

describe('CodeCell execution-count prompt', () => {
  const promptOf = (c: HTMLElement) => c.querySelector('.nb-cell-prompt')?.textContent;

  it('shows [*] while running', () => {
    const { container } = render(<CodeCell cell={cell} highlight={false} running />);
    expect(promptOf(container)).toBe('[*]');
  });

  it('shows the LIVE count [N] once a run finishes', () => {
    // The regression the user hit: a run that produced no execute_result still
    // gets its count from execute_reply → liveExecutionCount, so [ ] → [N].
    const noCountCell: CodeCellT = { ...cell, source: 'k = 5', executionCount: null, outputs: [] };
    const { container } = render(
      <CodeCell cell={noCountCell} highlight={false} liveExecutionCount={7} />
    );
    expect(promptOf(container)).toBe('[7]');
  });

  it('falls back to the persisted count when there is no live count', () => {
    const { container } = render(<CodeCell cell={cell} highlight={false} />); // cell.executionCount = 1
    expect(promptOf(container)).toBe('[1]');
  });

  it('shows an empty prompt [ ] when the cell has never run', () => {
    const neverRun: CodeCellT = { ...cell, executionCount: null, outputs: [] };
    const { container } = render(<CodeCell cell={neverRun} highlight={false} />);
    expect(promptOf(container)).toBe('[ ]');
  });

  it('treats a live "*" placeholder as running', () => {
    const { container } = render(<CodeCell cell={cell} highlight={false} liveExecutionCount="*" />);
    expect(promptOf(container)).toBe('[*]');
  });
});
