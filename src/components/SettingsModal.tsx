// Global application preferences modal. Opened from the Eigendeck menu
// (Settings…, Cmd+,). One section per preference; today only the asset
// auto-reload toggle. Per-presentation and per-asset overrides live in
// the Inspector — this is for app-wide defaults.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePreference } from '../lib/preferences';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, minWidth: 480, maxWidth: 640,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Settings</div>
          <button onClick={onClose} title="Close"
            style={{
              padding: 0, width: 28, height: 28, fontSize: 18,
              background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280',
            }}>×</button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AutoReloadAssetsSetting />
          <MathPreambleSetting />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MathPreambleSetting() {
  const [value, setValue] = usePreference('mathPreamble');
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Default LaTeX preamble</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
        New presentations start with this preamble. Existing presentations can pull from it
        via "Insert global" / "Replace with global" on the per-presentation preamble field.
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="\\newcommand{\\R}{\\mathbb{R}}"
        style={{
          width: '100%', boxSizing: 'border-box',
          fontFamily: 'monospace', fontSize: 12,
          minHeight: 120, resize: 'vertical',
          padding: 6, border: '1px solid #d1d5db', borderRadius: 4,
        }} />
    </div>
  );
}

function AutoReloadAssetsSetting() {
  const [value, setValue] = usePreference('autoReloadAssets');
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Auto-reload assets on disk change</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            When a linked SVG, image, or HTML demo's source file changes on disk,
            reload it into the presentation automatically. Per-presentation and
            per-asset settings can override this default.
          </div>
        </div>
      </label>
    </div>
  );
}
