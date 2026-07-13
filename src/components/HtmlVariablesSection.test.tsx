import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HtmlVariablesSection } from './PropertiesPanel';

// HelpText reads a preference; stub it to a stable value so the section renders.
vi.mock('../lib/preferences', () => ({ usePreference: () => [true, () => {}] }));

const manifest = (obj: Record<string, unknown>) =>
  `<script type="application/eigendeck-vars+json">${JSON.stringify(obj)}</script>`;

describe('HtmlVariablesSection', () => {
  it('renders nothing when no manifest is declared', () => {
    const { container } = render(
      <HtmlVariablesSection html="<div>plain</div>" vars={undefined} onChange={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders one control per declared variable with labels', () => {
    const html = manifest({
      value: { type: 'float', default: 62, min: 0, max: 100, label: 'Value', help: 'Needle position' },
      unit: { type: 'string', default: '%' },
    });
    render(<HtmlVariablesSection html={html} vars={undefined} onChange={() => {}} />);
    expect(screen.getByText('Value:')).toBeTruthy();
    expect(screen.getByText('Needle position')).toBeTruthy(); // author help
    expect(screen.getByText('unit:')).toBeTruthy();           // falls back to the name
  });

  it('flags an out-of-range stored value with a red ✕', () => {
    const html = manifest({ v: { type: 'float', default: 0, min: 0, max: 100 } });
    render(<HtmlVariablesSection html={html} vars={{ v: 999 }} onChange={() => {}} />);
    expect(screen.getByLabelText('invalid')).toBeTruthy();
  });

  it('writes a valid edit and drops the key when it equals the default', () => {
    const html = manifest({ v: { type: 'float', default: 10, min: 0, max: 100 } });
    const onChange = vi.fn();
    render(<HtmlVariablesSection html={html} vars={{ v: 50 }} onChange={onChange} />);
    const box = screen.getByRole('textbox') as HTMLInputElement; // the text box, not the slider

    fireEvent.change(box, { target: { value: '80' } });
    expect(onChange).toHaveBeenLastCalledWith({ v: 80 });

    fireEvent.change(box, { target: { value: '10' } }); // back to the default
    expect(onChange).toHaveBeenLastCalledWith({}); // key dropped
  });

  it('does not write while the value is invalid', () => {
    const html = manifest({ v: { type: 'int', default: 1 } });
    const onChange = vi.fn();
    render(<HtmlVariablesSection html={html} vars={undefined} onChange={onChange} />);
    const box = screen.getByDisplayValue('1') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '2.5' } }); // not an integer
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('invalid')).toBeTruthy();
  });
});
