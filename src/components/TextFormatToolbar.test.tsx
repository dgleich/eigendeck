// CHARACTERIZATION NET for the inline text-format toolbar's color control (path A).
// Unlike the inspector controls it does NOT write element fields — it edits inline
// HTML via document.execCommand('foreColor', hex). Pins the exact palette offered
// and the execCommand call so the upcoming <ColorControl> unification (which must
// support an "inline HTML" write mode) can be proven output-identical.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { usePresentationStore } from '../store/presentation';
import { TextFormatToolbar } from './TextFormatToolbar';

function seedPalette(customPalette?: string[]) {
  usePresentationStore.setState({
    presentation: {
      title: 'T', theme: 'white', slides: [],
      config: { width: 1920, height: 1080, ...(customPalette ? { customPalette } : {}) },
    },
  } as never);
}
const execMock = () => document.execCommand as unknown as ReturnType<typeof vi.fn>;
function openDropdown(container: HTMLElement) {
  fireEvent.click(container.querySelector('button[title="Text color"]') as HTMLButtonElement);
}
const dropdownSwatches = (container: HTMLElement) =>
  [...container.querySelectorAll('.tf-color-dropdown button.tf-color-swatch')] as HTMLButtonElement[];

beforeEach(() => {
  cleanup();
  document.execCommand = vi.fn(() => true);
});

describe('[characterize] inline text-color toolbar', () => {
  it('a swatch calls execCommand("foreColor", hex)', () => {
    seedPalette();
    const { container } = render(<TextFormatToolbar onClose={() => {}} />);
    openDropdown(container);
    fireEvent.click(dropdownSwatches(container)[0]);
    expect(execMock()).toHaveBeenCalledWith('foreColor', false, '#222222');
  });

  it('offers exactly COLORS (each dispatched as foreColor)', () => {
    seedPalette();
    const { container } = render(<TextFormatToolbar onClose={() => {}} />);
    const written: string[] = [];
    // Clicking a swatch closes the dropdown, so reopen each iteration.
    for (let i = 0; i < 17; i++) {
      openDropdown(container);
      const sw = dropdownSwatches(container);
      fireEvent.click(sw[i]);
      const calls = execMock().mock.calls;
      written.push(calls[calls.length - 1][2] as string);
    }
    expect(written).toEqual([
      '#222222', '#6b7280', '#9ca3af', '#d1d5db', '#16a34a', '#86efac',
      '#0d9488', '#5eead4', '#2563eb', '#93c5fd', '#dc2626', '#fca5a5',
      '#ea580c', '#fdba74', '#9333ea', '#c4b5fd', '#ffffff',
    ]);
  });

  it('shows deck customPalette swatches first (also foreColor)', () => {
    seedPalette(['#ff00ff']);
    const { container } = render(<TextFormatToolbar onClose={() => {}} />);
    openDropdown(container);
    fireEvent.click(dropdownSwatches(container)[0]);
    expect(execMock()).toHaveBeenCalledWith('foreColor', false, '#ff00ff');
  });
});
