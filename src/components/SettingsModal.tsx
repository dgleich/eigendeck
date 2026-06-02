// Global application preferences modal. Opened from the Eigendeck menu
// (Settings…, Cmd+,). One section per preference; today the asset
// auto-reload toggle and the global LaTeX preamble. Per-presentation and
// per-asset overrides live in the Inspector — this is for app-wide
// defaults.
//
// This is a webview-based modal; native settings window is tracked in
// https://github.com/dgleich/eigendeck/issues/62

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePreference } from '../lib/preferences';
import { DEFAULT_TEXT_SIZES, type NamedSize } from '../types/presentation';

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
          <DefaultTextSizesSetting />
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

function DefaultTextSizesSetting() {
  // Same shape as the deck-level Text sizes editor in the Inspector,
  // but bound to the GLOBAL pref instead of the current presentation's
  // config. New presentations are seeded from these values (see
  // createSeededPresentation in src/store/presentation.ts).
  // Existing decks are not affected — they keep whatever sizes they
  // were saved with. To apply a global default to an existing deck,
  // edit the deck's own Text sizes section in the Inspector.
  const [value, setValue] = usePreference('textSizes');
  const order: NamedSize[] = ['footnote', 'note', 'body', 'title', 'hype'];
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Default text sizes (px)</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
        Seed values for the type scale in NEW presentations.
        Existing decks aren't touched. The deck's own Text sizes
        section in the Inspector overrides these per-presentation.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {order.map((name) => {
          const fallback = DEFAULT_TEXT_SIZES[name];
          const current = value[name];
          const overridden = current != null;
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#374151', width: 70 }}>{name}</span>
              <input
                type="number"
                min={8} max={200} step={1}
                value={current ?? ''}
                placeholder={String(fallback)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const next = { ...value };
                  if (raw === '') { delete next[name]; }
                  else {
                    const v = parseInt(raw, 10);
                    if (!Number.isFinite(v) || v < 8 || v > 200) return;
                    if (v === fallback) delete next[name];
                    else next[name] = v;
                  }
                  setValue(next);
                }}
                style={{ width: 56, padding: '3px 6px', fontSize: 12 }}
              />
              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: -2 }}>px</span>
              <span style={{
                fontSize: 11,
                color: overridden ? '#9ca3af' : '#6b7280',
                marginLeft: 8,
                fontStyle: overridden ? 'normal' : 'italic',
              }}>
                default {fallback}px
              </span>
            </div>
          );
        })}
      </div>
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
