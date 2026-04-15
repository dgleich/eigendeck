import { useState } from 'react';

const COLORS = [
  { color: '#222222', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#9ca3af', label: 'Medium Grey' },
  { color: '#d1d5db', label: 'Light Grey' },
  { color: '#16a34a', label: 'Green' },
  { color: '#86efac', label: 'Light Green' },
  { color: '#0d9488', label: 'Teal' },
  { color: '#5eead4', label: 'Light Teal' },
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
  const [lastColor, setLastColor] = useState('#2563eb');

  // Prevent toolbar clicks from stealing focus from the contentEditable
  const keepFocus = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const exec = (cmd: string, value?: string) => {
    // Ensure the contentEditable has focus before executing
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editable && document.activeElement !== editable) {
      editable.focus();
    }
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
      <button onClick={() => exec('strikeThrough')} title="Strikethrough">
        <s>S</s>
      </button>
      <span className="tf-divider" />

      {/* Text color */}
      <div className="tf-color-wrapper">
        <button onClick={() => setColorOpen(!colorOpen)} title="Text color"
          style={{ position: 'relative' }}>
          <span style={{ fontWeight: 700 }}>A</span>
          <span style={{
            position: 'absolute', bottom: 3, left: 4, right: 4, height: 3,
            background: lastColor, borderRadius: 1,
          }} />
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
                  setLastColor(c.color);
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <span className="tf-divider" />

      <button onClick={() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.style.textTransform = 'uppercase';
          span.style.letterSpacing = '0.08em';
          try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
        }
      }} title="Uppercase + letter spacing">AA</button>
      <span className="tf-divider" />

      <button onClick={() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        // Check if already in a list — toggle off
        let node: Node | null = sel.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
        const li = (node as HTMLElement)?.closest?.('li');
        if (li) {
          const ul = li.closest('ul');
          if (ul) {
            // Unwrap: replace UL with its li contents as divs
            const parent = ul.parentNode!;
            for (const item of Array.from(ul.children)) {
              const div = document.createElement('div');
              div.innerHTML = (item as HTMLElement).innerHTML;
              parent.insertBefore(div, ul);
            }
            parent.removeChild(ul);
            return;
          }
        }

        // Try execCommand first (works in some WebKit versions)
        const ok = document.execCommand('insertUnorderedList', false);
        if (ok) return;

        // Fallback: insert via insertHTML
        if (!sel.isCollapsed) {
          const text = sel.toString();
          const lines = text.split('\n').filter(Boolean);
          const html = '<ul>' + lines.map(l => `<li>${l}</li>`).join('') + '</ul>';
          document.execCommand('insertHTML', false, html);
        } else {
          document.execCommand('insertHTML', false, '<ul><li><br></li></ul>');
        }
      }} title="Bullet list">List</button>
      <span className="tf-divider" />

      <button onClick={() => exec('justifyLeft')} title="Align left">
        <span style={{ fontSize: 10, lineHeight: 1 }}>&#9776;</span>
      </button>
      <button onClick={() => exec('justifyCenter')} title="Align center">
        <span style={{ fontSize: 10, lineHeight: 1 }}>&#9779;</span>
      </button>
      <button onClick={() => exec('justifyRight')} title="Align right">
        <span style={{ fontSize: 10, lineHeight: 1 }}>&#9778;</span>
      </button>
      <span className="tf-divider" />

      <button onClick={() => exec('removeFormat')} title="Strip formatting from selection (removes bold, italic, color, etc.)">
        <span style={{ textDecoration: 'line-through', fontWeight: 400 }}>T</span>
      </button>
    </div>
  );
}
