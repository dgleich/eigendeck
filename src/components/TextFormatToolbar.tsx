import { useState } from 'react';

const FONT_SIZES = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];

const COLORS = [
  { color: '#222222', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#d1d5db', label: 'Light Grey' },
  { color: '#16a34a', label: 'Green' },
  { color: '#86efac', label: 'Light Green' },
  { color: '#2563eb', label: 'Blue' },
  { color: '#93c5fd', label: 'Light Blue' },
  { color: '#dc2626', label: 'Red' },
  { color: '#fca5a5', label: 'Light Red' },
  { color: '#ea580c', label: 'Orange' },
  { color: '#fdba74', label: 'Light Orange' },
  { color: '#9333ea', label: 'Purple' },
  { color: '#c4b5fd', label: 'Light Purple' },
  { color: '#ffffff', label: 'White' },
];

/**
 * Floating toolbar for formatting text inside contentEditable elements.
 * Uses document.execCommand which works directly on the browser selection.
 *
 * Must be rendered OUTSIDE the contentEditable element to avoid
 * stealing focus. The toolbar uses onMouseDown + preventDefault
 * to keep focus in the editor.
 */
export function TextFormatToolbar() {
  const [colorOpen, setColorOpen] = useState(false);

  // Prevent toolbar clicks from stealing focus from the contentEditable
  const keepFocus = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
  };

  return (
    <div className="text-format-toolbar" onMouseDown={keepFocus}>
      <button onClick={() => exec('bold')} title="Bold (Cmd+B)">
        <b>B</b>
      </button>
      <button onClick={() => exec('italic')} title="Italic (Cmd+I)">
        <i>I</i>
      </button>
      <button onClick={() => exec('underline')} title="Underline (Cmd+U)">
        <u>U</u>
      </button>
      <span className="tf-divider" />

      {/* Font family */}
      <select
        className="tf-select"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            exec('fontName', e.target.value);
            e.target.value = '';
          }
        }}
        title="Font"
      >
        <option value="" disabled>Font</option>
        <option value="PT Sans">PT Sans</option>
        <option value="PT Sans Narrow">PT Sans Narrow</option>
        <option value="monospace">Monospace</option>
      </select>

      {/* Font size — execCommand fontSize uses 1-7 scale, so we use a span trick */}
      <select
        className="tf-select"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            // execCommand fontSize only supports 1-7, so we use a different approach:
            // wrap selection in a span with explicit font-size
            const size = e.target.value;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
              const range = sel.getRangeAt(0);
              const span = document.createElement('span');
              span.style.fontSize = size + 'px';
              range.surroundContents(span);
              sel.removeAllRanges();
              sel.addRange(range);
            }
            e.target.value = '';
          }
        }}
        title="Font size"
      >
        <option value="" disabled>Size</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <span className="tf-divider" />

      {/* Text color */}
      <div className="tf-color-wrapper">
        <button onClick={() => setColorOpen(!colorOpen)} title="Text color">
          A<span className="tf-color-indicator" />
        </button>
        {colorOpen && (
          <div className="tf-color-dropdown">
            {COLORS.map((c) => (
              <button
                key={c.color}
                className="tf-color-swatch"
                style={{ background: c.color, border: c.color === '#ffffff' ? '1px solid #ccc' : '1px solid transparent' }}
                title={c.label}
                onClick={() => {
                  exec('foreColor', c.color);
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <span className="tf-divider" />

      {/* Uppercase + letter spacing */}
      <button
        onClick={() => {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const span = document.createElement('span');
            span.style.textTransform = 'uppercase';
            span.style.letterSpacing = '0.08em';
            range.surroundContents(span);
          }
        }}
        title="Uppercase + letter spacing"
      >
        AA
      </button>

      {/* Bullet list */}
      <button onClick={() => exec('insertUnorderedList')} title="Bullet list">
        List
      </button>

      {/* Clear formatting */}
      <button onClick={() => exec('removeFormat')} title="Clear formatting">
        ×
      </button>
    </div>
  );
}
