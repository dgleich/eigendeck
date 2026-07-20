// "Paste as…" chooser (docs/copy-and-paste.md Stage 4). Lists the
// representations actually on the clipboard and lets the user pick one, instead
// of the automatic paste ladder. In-webview modal (cross-platform + testable);
// a native popup-menu version is tracked separately.
import { useEffect, useRef } from 'react';
import type { PasteRep, PasteKind } from '../lib/pasteAs';

interface Props {
  reps: PasteRep[];
  onPick: (kind: PasteKind) => void;
  onCancel: () => void;
}

const HINTS: Record<PasteKind, string> = {
  image: 'Insert the bitmap as an image element',
  svg: 'Insert the vector as an image element',
  pdf: 'Insert the PDF as an image element',
  html: 'Insert the raw HTML as an HTML element',
  text: 'Insert as an editable text element (adopts the deck style)',
};

export function PasteAsModal({ reps, onPick, onCancel }: Props) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      // Number keys 1..N pick the nth representation.
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= reps.length) {
        e.preventDefault();
        onPick(reps[n - 1].kind);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [reps, onPick, onCancel]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Paste as"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 100000, paddingTop: 60,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
        padding: '20px 22px 16px', width: 420,
        font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 }}>Paste as…</div>
        <div style={{ color: '#6b7280', marginBottom: 14 }}>
          {reps.length ? 'Choose how to paste the clipboard contents.' : 'Nothing on the clipboard can be pasted.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {reps.map((r, i) => (
            <button
              key={r.kind}
              ref={i === 0 ? firstRef : undefined}
              onClick={() => onPick(r.kind)}
              style={repButton}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  minWidth: 18, height: 18, borderRadius: 4, background: '#eef2ff', color: '#3730a3',
                  fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>{r.label}</span>
              </span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>{HINTS[r.kind]}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={cancelButton}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const repButton: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
  padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff',
  cursor: 'pointer', textAlign: 'left', font: 'inherit', width: '100%',
};

const cancelButton: React.CSSProperties = {
  padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 5, background: '#fff',
  fontSize: 13, cursor: 'pointer', minWidth: 80, font: 'inherit',
};
