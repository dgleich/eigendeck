// "About Eigendeck" / Acknowledgements modal. Opened from the Eigendeck
// menu (About Eigendeck) and Help → Acknowledgements… — both route the
// menu-event id `about-eigendeck` to App.tsx, which flips `aboutOpen`.
//
// Mirrors SettingsModal's structure: portal to <body>, dimmed overlay,
// centered white card, Esc / × / overlay-click to close. The version is
// read from the Tauri app metadata; the credits list is a small static
// array so it's trivial to keep in sync with package.json / Cargo.toml.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const REPO_URL = 'https://github.com/dgleich/eigendeck';
const AUTHOR_URL = 'https://www.cs.purdue.edu/homes/dgleich/';

// Prominent bundled dependencies + fonts, name — license. Not every
// transitive dep — just the load-bearing OSS a user should know is in here.
// Verified against package.json and src-tauri/Cargo.toml.
type Credit = { name: string; license: string };

const SOFTWARE: Credit[] = [
  { name: 'Tauri (+ wry, tao)', license: 'Apache-2.0 / MIT' },
  { name: 'objc2 (macOS bindings)', license: 'MIT / Apache-2.0' },
  { name: 'React', license: 'MIT' },
  { name: 'Zustand + zundo', license: 'MIT' },
  { name: 'Vite', license: 'MIT' },
  { name: 'CodeMirror', license: 'MIT' },
  { name: 'MathJax', license: 'Apache-2.0' },
  { name: 'highlight.js', license: 'BSD-3-Clause' },
  { name: 'marked', license: 'MIT' },
  { name: 'modern-screenshot', license: 'MIT' },
  { name: 'SQLite (via rusqlite / better-sqlite3)', license: 'Public Domain / MIT' },
  { name: 'PDFium (bblanchon prebuilt / Chromium)', license: 'BSD-3-Clause / Apache-2.0' },
];

const FONTS: Credit[] = [
  { name: 'PT Sans & PT Sans Narrow', license: 'SIL OFL 1.1' },
  { name: 'MathJax math-font packs (derived from OFL fonts)', license: 'SIL OFL 1.1' },
];

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then((v) => { if (!cancelled) setVersion(v); })
      .catch(() => { /* non-Tauri / test env — leave version blank */ });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const openExternal = async (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch {
      /* opener unavailable (e.g. tests) — silently ignore */
    }
  };

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
          background: '#fff', borderRadius: 8,
          width: 520, maxWidth: '90vw',
          height: 580, maxHeight: '85vh',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>About Eigendeck</div>
          <button onClick={onClose} title="Close"
            style={{
              padding: 0, width: 28, height: 28, fontSize: 18,
              background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280',
            }}>×</button>
        </div>

        <div style={{ padding: '18px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
          {/* App identity — icon, name, version, tagline, author, links. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <img src="/eigendeck-logo.png" alt="Eigendeck" width={88} height={88}
              style={{ borderRadius: 18, marginBottom: 12 }} />
            <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Eigendeck</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
              {version ? `Version ${version}` : 'Version —'}
            </div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 12, lineHeight: 1.5, maxWidth: 400 }}>
              Build presentations with embedded interactive HTML demos and LaTeX math.
            </div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 14 }}>
              Created by{' '}
              <a href={AUTHOR_URL} onClick={(e) => openExternal(e, AUTHOR_URL)}
                style={{ color: '#2563eb', textDecoration: 'none', cursor: 'pointer', fontWeight: 600 }}>
                David Gleich
              </a>
            </div>
            <div style={{ fontSize: 12, marginTop: 8, display: 'flex', gap: 16 }}>
              <a href={REPO_URL} onClick={(e) => openExternal(e, REPO_URL)}
                style={{ color: '#2563eb', textDecoration: 'none', cursor: 'pointer' }}>GitHub</a>
              <a href={AUTHOR_URL} onClick={(e) => openExternal(e, AUTHOR_URL)}
                style={{ color: '#2563eb', textDecoration: 'none', cursor: 'pointer' }}>Website</a>
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 12 }}>© 2026 David Gleich</div>
          </div>

          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
            color: '#9ca3af', marginTop: 24, marginBottom: 8,
            borderTop: '1px solid #f0f0f0', paddingTop: 16,
          }}>Open source &amp; fonts</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>
            Eigendeck is built on the work of many open-source projects. With gratitude:
          </div>

          <CreditList items={SOFTWARE} />
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#374151',
            marginTop: 14, marginBottom: 6,
          }}>Fonts</div>
          <CreditList items={FONTS} />
        </div>

        <div style={{
          padding: '12px 18px', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose}
            style={{
              padding: '6px 16px', fontSize: 13,
              background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CreditList({ items }: { items: Credit[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((c) => (
        <div key={c.name} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#374151' }}>{c.name}</span>
          <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{c.license}</span>
        </div>
      ))}
    </div>
  );
}
