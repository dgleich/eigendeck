/**
 * macOS-style unsaved-changes confirmation dialog (Keynote-modeled).
 *
 * Rendered as an in-app modal (not a native sheet — Tauri 2's dialog plugin
 * doesn't expose 3-button confirms cleanly, and an in-app modal lets us
 * guarantee Esc=cancel, Enter=save, and consistent layout cross-platform).
 *
 * Two cases:
 *   - hasFile: "Do you want to save the changes you made to {title}?"
 *              [Don't Save] [Cancel] [Save]
 *   - !hasFile: "Do you want to keep this new document {title}?"
 *               [Delete] [Cancel] [Save…]
 *
 * Save is the primary/default action (Enter activates it). Esc cancels.
 * The destructive button (Don't Save / Delete) is leftmost per macOS HIG.
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** Document title shown in the message body */
  title: string;
  /** True if the document has been saved to disk before */
  hasFile: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ title, hasFile, onSave, onDiscard, onCancel }: Props) {
  const saveBtnRef = useRef<HTMLButtonElement>(null);

  // Focus Save (the default action) on open. Auto-focus also enables
  // Enter-to-activate via the browser's button focus behavior.
  useEffect(() => {
    saveBtnRef.current?.focus();
  }, []);

  // Esc cancels, regardless of focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter' && document.activeElement === saveBtnRef.current) {
        // Default behavior of Enter on a focused button — let it through;
        // we keep this handler around for Esc only.
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const message = hasFile
    ? `Do you want to save the changes you made to "${title}"? Your changes will be lost if you don't save them.`
    : `Do you want to keep this new document "${title}"? You can choose to save your changes, or delete this document immediately. You can't undo this action.`;

  const destructiveLabel = hasFile ? "Don't Save" : 'Delete';
  const saveLabel = hasFile ? 'Save' : 'Save…';

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="unsaved-msg"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 100000, paddingTop: 60,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
        padding: '24px 28px 18px',
        width: 480,
        font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}>
        <div id="unsaved-msg" style={{ marginBottom: 18, color: '#1f2937' }}>
          {message}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
        }}>
          {/* Destructive — leftmost (macOS convention). Visually subdued. */}
          <button onClick={onDiscard} style={dialogButton}>{destructiveLabel}</button>
          {/* Spacer pushes Cancel/Save to the right */}
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} style={dialogButton}>Cancel</button>
          <button ref={saveBtnRef} onClick={onSave} style={primaryButton}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

const dialogButton: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  minWidth: 80,
  font: 'inherit',
};

const primaryButton: React.CSSProperties = {
  ...dialogButton,
  background: '#2563eb',
  borderColor: '#2563eb',
  color: '#fff',
  fontWeight: 600,
};
