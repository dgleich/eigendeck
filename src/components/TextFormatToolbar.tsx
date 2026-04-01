import { useState, useCallback } from 'react';

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

interface Props {
  onClose: () => void;
}

export function TextFormatToolbar(_props: Props) {
  const [colorOpen, setColorOpen] = useState(false);

  // Save and restore selection across toolbar interactions
  const restoreFocusAndExec = useCallback((cmd: string, value?: string) => {
    // execCommand works on the current selection, which should still be
    // in the contentEditable since we use preventDefault on button mousedown
    document.execCommand(cmd, false, value);
  }, []);

  // For buttons: prevent default to keep focus in contentEditable
  const btnDown = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // For selects: let them work normally (they need focus), but
  // save selection first, then restore after change
  const wrapSelection = (fn: () => void) => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    fn();
    // Restore selection after a tick
    if (range) {
      setTimeout(() => {
        const s = window.getSelection();
        if (s) {
          s.removeAllRanges();
          s.addRange(range);
        }
      }, 0);
    }
  };

  return (
    <div className="text-format-toolbar" tabIndex={-1}>
      <button onMouseDown={btnDown} onClick={() => restoreFocusAndExec('bold')} title="Bold (Cmd+B)">
        <b>B</b>
      </button>
      <button onMouseDown={btnDown} onClick={() => restoreFocusAndExec('italic')} title="Italic (Cmd+I)">
        <i>I</i>
      </button>
      <button onMouseDown={btnDown} onClick={() => restoreFocusAndExec('underline')} title="Underline (Cmd+U)">
        <u>U</u>
      </button>
      <span className="tf-divider" />

      {/* Font family */}
      <select
        className="tf-select"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            wrapSelection(() => restoreFocusAndExec('fontName', e.target.value));
            e.target.value = '';
          }
        }}
        title="Font"
      >
        <option value="" disabled>Font</option>
        <option value="PT Sans">PT Sans</option>
        <option value="PT Sans Narrow">Narrow</option>
        <option value="monospace">Mono</option>
      </select>

      {/* Font size */}
      <select
        className="tf-select"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            const size = e.target.value;
            // execCommand fontSize only supports 1-7, use span wrapping
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
              const range = sel.getRangeAt(0);
              const span = document.createElement('span');
              span.style.fontSize = size + 'px';
              try {
                range.surroundContents(span);
              } catch {
                // surroundContents fails on partial selections, fallback
                span.appendChild(range.extractContents());
                range.insertNode(span);
              }
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
        <button onMouseDown={btnDown} onClick={() => setColorOpen(!colorOpen)} title="Text color">
          A
        </button>
        {colorOpen && (
          <div className="tf-color-dropdown">
            {COLORS.map((c) => (
              <button
                key={c.color}
                className="tf-color-swatch"
                style={{ background: c.color, border: c.color === '#ffffff' ? '1px solid #ccc' : '1px solid transparent' }}
                title={c.label}
                onMouseDown={btnDown}
                onClick={() => {
                  restoreFocusAndExec('foreColor', c.color);
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <span className="tf-divider" />

      <button onMouseDown={btnDown} onClick={() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.style.textTransform = 'uppercase';
          span.style.letterSpacing = '0.08em';
          try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
        }
      }} title="Uppercase + letter spacing">AA</button>

      <button onMouseDown={btnDown} onClick={() => restoreFocusAndExec('insertUnorderedList')} title="Bullet list">List</button>
      <button onMouseDown={btnDown} onClick={() => restoreFocusAndExec('removeFormat')} title="Clear formatting">×</button>
    </div>
  );
}
