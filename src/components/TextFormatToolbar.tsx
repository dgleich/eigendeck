import { useState, useRef, useEffect, useCallback } from 'react';

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
  const savedRange = useRef<Range | null>(null);

  // Continuously save the selection from the contentEditable
  useEffect(() => {
    const save = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable && editable.contains(r.commonAncestorContainer)) {
          savedRange.current = r.cloneRange();
        }
      }
    };
    document.addEventListener('selectionchange', save);
    // Save immediately on mount
    save();
    return () => document.removeEventListener('selectionchange', save);
  }, []);

  // Restore selection, focus, then execute command
  const exec = useCallback((cmd: string, value?: string) => {
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editable) {
      editable.focus();
      if (savedRange.current) {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.current);
        }
      }
    }
    document.execCommand(cmd, false, value);
  }, []);

  const btn = (label: React.ReactNode, cmd: string, title: string, value?: string) => (
    <button
      onMouseDown={(e) => { e.preventDefault(); }}
      onClick={() => exec(cmd, value)}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="text-format-toolbar" onMouseDown={(e) => e.preventDefault()}>
      {btn(<b>B</b>, 'bold', 'Bold (Cmd+B)')}
      {btn(<i>I</i>, 'italic', 'Italic (Cmd+I)')}
      {btn(<s>S</s>, 'strikeThrough', 'Strikethrough')}
      <span className="tf-divider" />

      {/* Text color */}
      <div className="tf-color-wrapper">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setColorOpen(!colorOpen)} title="Text color"
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
                onMouseDown={(e) => e.preventDefault()}
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

      <button onMouseDown={(e) => e.preventDefault()} onClick={() => {
        const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
        if (editable) { editable.focus(); if (savedRange.current) { const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); } } }
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

      <button onMouseDown={(e) => e.preventDefault()} onClick={() => {
        const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
        if (editable) { editable.focus(); if (savedRange.current) { const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); } } }
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        let node: Node | null = sel.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
        const li = (node as HTMLElement)?.closest?.('li');
        if (li) {
          const ul = li.closest('ul');
          if (ul) {
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

        const ok = document.execCommand('insertUnorderedList', false);
        if (ok) return;

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

      {btn(<span style={{ fontSize: 10, lineHeight: 1 }}>&#9776;</span>, 'justifyLeft', 'Align left')}
      {btn(<span style={{ fontSize: 10, lineHeight: 1 }}>&#9779;</span>, 'justifyCenter', 'Align center')}
      {btn(<span style={{ fontSize: 10, lineHeight: 1 }}>&#9778;</span>, 'justifyRight', 'Align right')}
      <span className="tf-divider" />

      {btn(<span style={{ textDecoration: 'line-through', fontWeight: 400 }}>T</span>, 'removeFormat', 'Strip formatting')}
    </div>
  );
}
