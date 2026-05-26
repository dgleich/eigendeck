// "Change this image to the version from X" modal — fires when the
// asset is shared by multiple elements and the user needs to choose
// scope. Solo-asset restores skip this and use a plain confirm().
// See docs/ASSETS.md.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeRestoreVersionDialog } from '../lib/restoreVersionDialog';

type Pending = {
  id: number;
  imageName: string;
  whenLabel: string;
  usageCount: number;
  resolve: (choice: 'this-only' | 'all' | 'cancel') => void;
};

export function RestoreVersionDialog() {
  const [req, setReq] = useState<Pending | null>(null);

  useEffect(() => {
    return subscribeRestoreVersionDialog((p) => setReq(p as Pending | null));
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

  const fileName = req.imageName.split('/').pop() ?? req.imageName;

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
          Change {fileName} to the version from {req.whenLabel}
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
          This image is used on {req.usageCount} slides. Do you want to
          change all of them, or just this one?
        </div>
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChoiceButton
            label="Change on this slide only"
            description="Other slides keep their current version."
            onClick={() => req.resolve('this-only')}
          />
          <ChoiceButton
            label={`Change on all ${req.usageCount} slides`}
            description="Every slide using this image switches to the older version."
            onClick={() => req.resolve('all')}
          />
        </div>
        <div style={{
          padding: '8px 20px 14px',
          display: 'flex', justifyContent: 'flex-end',
          borderTop: '1px solid #f0f0f0',
        }}>
          <button
            onClick={() => req.resolve('cancel')}
            style={{
              padding: '5px 12px', fontSize: 12,
              background: '#fff', border: '1px solid #d1d5db', borderRadius: 4,
              cursor: 'pointer',
            }}>
            Cancel
          </button>
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
