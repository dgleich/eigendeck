// The global busy spinner — a translucent, interaction-blocking overlay with a
// spinner + message, shown while a slow operation (large asset import, etc.) is
// in flight. Driven by useBusyStore / withBusy (src/store/busy.ts). Portaled to
// document.body so it sits above the CSS-scaled canvas and all panels.
import { createPortal } from 'react-dom';
import { useBusyStore } from '../store/busy';

export function BusyOverlay() {
  const message = useBusyStore((s) => s.message);
  if (!message) return null;
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <style>{'@keyframes busy-spin{to{transform:rotate(360deg)}}'}</style>
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          padding: '28px 40px', borderRadius: 12, background: '#fff',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
          fontFamily: "'PT Sans', sans-serif",
        }}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '4px solid #e2e2e2', borderTopColor: '#2563eb',
            animation: 'busy-spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: 16, color: '#333' }}>{message}</div>
      </div>
    </div>,
    document.body,
  );
}
