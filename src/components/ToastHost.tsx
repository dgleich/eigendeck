// Renders the global toast stack at the bottom-center of the window.
// Mount once in App.tsx near the root; call showToast() from anywhere.

import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast, type Toast } from '../lib/toasts';

const KIND_STYLES: Record<Toast['kind'], { border: string; bg: string; icon: string }> = {
  info:    { border: '#3b82f6', bg: '#eff6ff', icon: 'ⓘ' },
  warning: { border: '#f59e0b', bg: '#fffbeb', icon: '⚠' },
  error:   { border: '#dc2626', bg: '#fef2f2', icon: '⚠' },
  success: { border: '#16a34a', bg: '#f0fdf4', icon: '✓' },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: 'center',
      zIndex: 10000,
      pointerEvents: 'none',
    }}>
      {toasts.map((t) => {
        const s = KIND_STYLES[t.kind];
        return (
          <div key={t.id} style={{
            background: s.bg,
            border: `1px solid ${s.border}`,
            borderLeft: `4px solid ${s.border}`,
            borderRadius: 6,
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 360,
            maxWidth: 560,
            fontSize: 13,
            color: '#1f2937',
            pointerEvents: 'auto',
          }}>
            <span style={{ color: s.border, fontSize: 16, fontWeight: 600, lineHeight: 1 }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action?.onClick(); dismissToast(t.id); }}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  background: s.border,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}>
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(t.id)}
              title="Dismiss"
              style={{
                padding: 0,
                width: 20, height: 20,
                background: 'transparent',
                color: '#6b7280',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
              }}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
