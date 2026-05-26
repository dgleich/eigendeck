// "Asset has silently changed since first add" awareness dialog.
//
// User must explicitly opt in to one of two actions; no default focus.
// Esc / outside-click cancels (abandons the insertion entirely) even
// though no visible Cancel button exists — users expect Esc to back
// out of a modal.
//
// See docs/ASSETS.md → "Path collision dialog" for the design.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeCollisionDialog } from '../lib/collisionDialog';

type Pending = {
  id: number;
  path: string;
  slideNumbers: number[];
  resolve: (choice: 'accept' | 'revert' | 'cancel') => void;
};

export function CollisionDialog() {
  const [req, setReq] = useState<Pending | null>(null);

  useEffect(() => {
    return subscribeCollisionDialog((p) => setReq(p as Pending | null));
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

  const fileName = req.path.split('/').pop() ?? req.path;
  const slideList = formatSlideList(req.slideNumbers);

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
          {fileName} has changed
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
          <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>
            {fileName}
          </code>{' '}
          has changed since you added it on {slideList}. The default
          behavior in Eigendeck is to update it to the latest version when
          it changes, which has already happened. Both the existing and
          new copy will now show the updated version.
        </div>
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChoiceButton
            label="I understand and want this auto-updating behavior."
            onClick={() => req.resolve('accept')}
          />
          <ChoiceButton
            label={`I want to revert the contents of ${slideList} to the previous version and add this as a new version. I don't want the auto-updating behavior. (This will disable it for this presentation.)`}
            onClick={() => req.resolve('revert')}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceButton({ label, onClick }: { label: string; onClick: () => void }) {
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
        fontSize: 12,
        color: '#111827',
        lineHeight: 1.4,
      }}>
      {label}
    </button>
  );
}

function formatSlideList(nums: number[]): string {
  if (nums.length === 0) return 'no slides';  // shouldn't fire — caller skips dialog in that case
  if (nums.length === 1) return `slide ${nums[0]}`;
  if (nums.length === 2) return `slides ${nums[0]} and ${nums[1]}`;
  const head = nums.slice(0, -1).join(', ');
  return `slides ${head}, and ${nums[nums.length - 1]}`;
}
