import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasteAsModal } from './PasteAsModal';
import type { PasteRep } from '../lib/pasteAs';

const REPS: PasteRep[] = [
  { kind: 'image', label: 'Image' },
  { kind: 'html', label: 'HTML element' },
  { kind: 'text', label: 'Text' },
];

describe('PasteAsModal', () => {
  it('renders one button per representation', () => {
    render(<PasteAsModal reps={REPS} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /Image/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HTML element/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Text/ })).toBeTruthy();
  });

  it('clicking a representation calls onPick with its kind', () => {
    const onPick = vi.fn();
    render(<PasteAsModal reps={REPS} onPick={onPick} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /HTML element/ }));
    expect(onPick).toHaveBeenCalledWith('html');
  });

  it('number keys pick the nth representation', () => {
    const onPick = vi.fn();
    render(<PasteAsModal reps={REPS} onPick={onPick} onCancel={() => {}} />);
    fireEvent.keyDown(window, { key: '3' });
    expect(onPick).toHaveBeenCalledWith('text');
  });

  it('a number past the end does nothing', () => {
    const onPick = vi.fn();
    render(<PasteAsModal reps={REPS} onPick={onPick} onCancel={() => {}} />);
    fireEvent.keyDown(window, { key: '9' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape cancels', () => {
    const onCancel = vi.fn();
    render(<PasteAsModal reps={REPS} onPick={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('empty representation list shows a "nothing to paste" message and only Cancel', () => {
    render(<PasteAsModal reps={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Nothing on the clipboard/)).toBeTruthy();
    // Only the Cancel button exists (no representation buttons).
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
