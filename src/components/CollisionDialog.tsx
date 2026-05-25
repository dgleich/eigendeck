// Renders the path-collision dialog when the asset-insertion helper
// asks for a user choice. Mount once in App.tsx near the root.
//
// Three buttons (no default focus); a checkbox below to remember the
// choice for the rest of the app session. See docs/ASSETS.md.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeCollisionDialog } from '../lib/collisionDialog';

type Pending = {
  id: number;
  path: string;
  existingExternalPath: string | null;
  usageCount: number;
  slideCount: number;
  resolve: (choice: 'update' | 'new' | 'cancel', rememberForSession: boolean) => void;
};

export function CollisionDialog() {
  const [req, setReq] = useState<Pending | null>(null);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    return subscribeCollisionDialog((p) => {
      setReq(p as Pending | null);
      setRemember(false);  // reset every time a new dialog opens
    });
  }, []);

  useEffect(() => {
    if (!req) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); req.resolve('cancel', remember); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [req, remember]);

  if (!req) return null;

  const usageDescription = req.usageCount === 0
    ? 'No other elements currently use this asset.'
    : req.usageCount === 1 && req.slideCount === 1
      ? '1 element on 1 slide currently uses this asset.'
      : `${req.usageCount} element${req.usageCount === 1 ? '' : 's'} across ${req.slideCount} slide${req.slideCount === 1 ? '' : 's'} currently use this asset.`;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}>
      <div
        style={{
          background: '#fff', borderRadius: 8, minWidth: 480, maxWidth: 600,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{ padding: '16px 20px 8px', fontSize: 15, fontWeight: 600 }}>
          Asset already exists
        </div>
        <div style={{ padding: '0 20px 12px', fontSize: 13, color: '#374151', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            An asset with path{' '}
            <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>
              {req.path}
            </code>
            {' '}already exists, and the new file's contents differ.
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {usageDescription}
            {req.existingExternalPath && (
              <>
                <br />
                Currently linked to{' '}
                <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>
                  {req.existingExternalPath}
                </code>.
              </>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Choose one:
          </div>
        </div>
        <div style={{ padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChoiceButton
            label="Update existing asset"
            description="Both this new element and all other elements using the asset will show the new bytes. Old version goes to history."
            onClick={() => req.resolve('update', remember)}
          />
          <ChoiceButton
            label="Add as a new asset"
            description="Create a separate asset (same path label). Older elements keep their original appearance; only the new element shows the new bytes."
            onClick={() => req.resolve('new', remember)}
          />
        </div>
        <div style={{
          padding: '8px 20px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #f0f0f0',
        }}>
          <label style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)} />
            Don't ask again this session
          </label>
          <button
            onClick={() => req.resolve('cancel', remember)}
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

function ChoiceButton({
  label, description, onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
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
