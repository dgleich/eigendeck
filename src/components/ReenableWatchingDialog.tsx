// Confirmation dialog shown when re-enabling per-presentation auto-
// reload after it was previously OFF. Two explicit choices + Esc =
// cancel. See docs/ASSETS.md → "Re-enabling auto-reload" for the
// design.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeReenableWatchingDialog } from '../lib/reenableWatchingDialog';

type Pending = {
  id: number;
  resolve: (choice: 'new-only' | 'rescan-all' | 'cancel') => void;
};

export function ReenableWatchingDialog() {
  const [req, setReq] = useState<Pending | null>(null);

  useEffect(() => {
    return subscribeReenableWatchingDialog((p) => setReq(p as Pending | null));
  }, []);

  useEffect(() => {
    if (!req) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); req.resolve('cancel'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [req]);

  if (!req) return null;

  return createPortal(
    <div
      onClick={() => req.resolve('cancel')}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, minWidth: 520, maxWidth: 640,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{ padding: '16px 20px 8px', fontSize: 15, fontWeight: 600 }}>
          Re-enabling auto-reload
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
          Auto-reload was off for this presentation. What about the
          assets you added while it was off?
        </div>
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChoiceButton
            label="Only enable for new files"
            description="Existing assets stay at their current bytes; no surprise auto-updates. You can still flip individual assets back on in their Properties panel. Future inserts get watched normally."
            onClick={() => req.resolve('new-only')}
          />
          <ChoiceButton
            label="Re-enable and re-scan all"
            description="Existing assets resume watching. The presentation scans now for any files that changed on disk while auto-reload was off, and updates everything that uses the same path."
            onClick={() => req.resolve('rescan-all')}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceButton({ label, description, onClick }: {
  label: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        background: '#f9fafb',
        border: '1px solid #d1d5db',
        borderRadius: 5,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>{description}</div>
    </button>
  );
}
