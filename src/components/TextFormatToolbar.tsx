import { useState, useRef, useEffect, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { ColorControl } from './ColorControl';
import { TEXT_PALETTE } from '../lib/colorPalettes';

interface Props {
  onClose: () => void;
}

export function TextFormatToolbar(_props: Props) {
  const [colorOpen, setColorOpen] = useState(false);
  const [lastColor, setLastColor] = useState('#2563eb');
  const savedRange = useRef<Range | null>(null);
  // Per-presentation custom palette (#2) — shown as a leading row of swatches.
  const customPalette = usePresentationStore((s) => s.presentation?.config?.customPalette);

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
    save();
    return () => document.removeEventListener('selectionchange', save);
  }, []);

  // Restore focus + selection, then run action
  const restoreSelection = useCallback(() => {
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editable) {
      editable.focus();
      if (savedRange.current) {
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
      }
    }
  }, []);

  const exec = useCallback((cmd: string, value?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, value);
  }, [restoreSelection]);

  // Prevent mousedown from blurring contentEditable
  const pd = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="text-format-toolbar" onMouseDown={pd}>
      <button onClick={() => exec('bold')} title="Bold (Cmd+B)"><b>B</b></button>
      <button onClick={() => exec('italic')} title="Italic (Cmd+I)"><i>I</i></button>
      <button onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
      <span className="tf-divider" />

      {/* Text color */}
      <div className="tf-color-wrapper">
        <button onClick={() => setColorOpen(!colorOpen)} title="Text color" style={{ position: 'relative' }}>
          <span style={{ fontWeight: 700 }}>A</span>
          <span style={{ position: 'absolute', bottom: 3, left: 4, right: 4, height: 3, background: lastColor, borderRadius: 1 }} />
        </button>
        {colorOpen && (
          <div className="tf-color-dropdown">
            <ColorControl
              value={lastColor}
              palette={TEXT_PALETTE}
              customPalette={customPalette}
              onColor={(c) => { exec('foreColor', c); setLastColor(c); setColorOpen(false); }}
            />
          </div>
        )}
      </div>
      <span className="tf-divider" />

      <button onClick={() => {
        restoreSelection();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.style.textTransform = 'uppercase';
          span.style.letterSpacing = '0.08em';
          try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
        }
      }} title="Uppercase + letter spacing">AA</button>

      <button onClick={() => {
        restoreSelection();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        // Toggle OFF if the selection sits inside an existing <code> run.
        let node: Node | null = sel.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
        const codeEl = (node as HTMLElement | null)?.closest?.('code');
        if (codeEl) {
          const parent = codeEl.parentNode!;
          while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
          parent.removeChild(codeEl);
          return;
        }
        const range = sel.getRangeAt(0);
        const code = document.createElement('code');
        try { range.surroundContents(code); } catch { code.appendChild(range.extractContents()); range.insertNode(code); }
      }} title="Monospace / code"><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>&lt;/&gt;</span></button>
      <span className="tf-divider" />

      <button onClick={() => {
        restoreSelection();
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

      <button onClick={() => exec('removeFormat')} title="Strip formatting">
        <span style={{ textDecoration: 'line-through', fontWeight: 400 }}>T</span>
      </button>
    </div>
  );
}
