import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HtmlVariablesSection } from './PropertiesPanel';

// HelpText reads a preference; stub it to a stable value so the section renders.
vi.mock('../lib/preferences', () => ({ usePreference: () => [true, () => {}] }));

const theme = { background: '#ffffff', accent: '#3b82f6', text: '#111827' } as any;
const manifest = (obj: Record<string, unknown>) =>
  `<script type="application/eigendeck-vars+json">${JSON.stringify(obj)}</script>`;
const renderVars = (html: string, vars: any, onChange = () => {}) =>
  render(<HtmlVariablesSection html={html} vars={vars} theme={theme} onChange={onChange} />);

describe('HtmlVariablesSection', () => {
  it('renders nothing when no manifest is declared', () => {
    const { container } = renderVars('<div>plain</div>', undefined);
    expect(container.textContent).toBe('');
  });

  it('renders one control per declared variable with labels', () => {
    const html = manifest({
      value: { type: 'float', default: 62, min: 0, max: 100, label: 'Value', help: 'Needle position' },
      unit: { type: 'string', default: '%' },
    });
    renderVars(html, undefined);
    expect(screen.getByText('Value:')).toBeTruthy();
    expect(screen.getByText('Needle position')).toBeTruthy(); // author help
    expect(screen.getByText('unit:')).toBeTruthy();           // falls back to the name
  });

  it('flags an out-of-range stored value with a red ✕', () => {
    const html = manifest({ v: { type: 'float', default: 0, min: 0, max: 100 } });
    renderVars(html, { v: 999 });
    expect(screen.getByLabelText('invalid')).toBeTruthy();
  });

  it('writes a valid edit and drops the key when it equals the default', () => {
    const html = manifest({ v: { type: 'float', default: 10, min: 0, max: 100 } });
    const onChange = vi.fn();
    renderVars(html, { v: 50 }, onChange);
    const box = screen.getByRole('textbox') as HTMLInputElement; // the text box, not the slider

    fireEvent.change(box, { target: { value: '80' } });
    expect(onChange).toHaveBeenLastCalledWith({ v: 80 });

    fireEvent.change(box, { target: { value: '10' } }); // back to the default
    expect(onChange).toHaveBeenLastCalledWith({}); // key dropped
  });

  it('renders a textarea for a multiline string', () => {
    const html = manifest({ caption: { type: 'string', default: 'a\nb', multiline: true, label: 'Caption' } });
    const onChange = vi.fn();
    const { container } = renderVars(html, undefined, onChange);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe('a\nb');
    fireEvent.change(ta, { target: { value: 'line1\nline2' } });
    expect(onChange).toHaveBeenLastCalledWith({ caption: 'line1\nline2' });
  });

  it('does not write while the value is invalid', () => {
    const html = manifest({ v: { type: 'int', default: 1 } });
    const onChange = vi.fn();
    renderVars(html, undefined, onChange);
    const box = screen.getByDisplayValue('1') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '2.5' } }); // not an integer
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('invalid')).toBeTruthy();
  });

  it('color var: stores a tint token when a tint swatch is picked', () => {
    const html = manifest({ fill: { type: 'color', default: '#e11d48', label: 'Fill' } });
    const onChange = vi.fn();
    const { container } = renderVars(html, undefined, onChange);
    // The 'accent' tint swatch carries a title beginning "Theme accent…".
    const tintBtn = container.querySelector('[title^="Theme accent"]') as HTMLElement;
    expect(tintBtn).toBeTruthy();
    fireEvent.click(tintBtn);
    expect(onChange).toHaveBeenLastCalledWith({ fill: 'tint:accent' });
  });

  it('color var: accepts a tint token as the default without a red ✕', () => {
    const html = manifest({ fill: { type: 'color', default: 'tint:accent' } });
    renderVars(html, undefined);
    expect(screen.queryByLabelText('invalid')).toBeNull();
  });
});
