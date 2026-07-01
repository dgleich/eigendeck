// Deck-wide asset-security panel (docs/ASSETS-SECURITY.md): a non-modal, dismissible
// card listing every external file this deck links, its RESOLVED real target, where
// it's used, and its state (approved / eligible / forbidden / missing). Lets the user
// approve eligible paths or trust the whole deck. Forbidden rows are shown (so you see
// what a deck tried to reach) but are never approvable.
//
// Rendered via a portal so it floats above the app; a light click-outside layer
// dismisses it. It is NOT a blocking modal — the design forbids trapping the user.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { buildDeckSecurityReport, approveOne, type DeckSecurityReport, type RowState } from '../lib/securityReport';
import { trustCurrentDeck } from '../store/fileOps';

const STATE_STYLE: Record<RowState, { label: string; color: string; bg: string }> = {
  approved:  { label: 'Watched',   color: '#166534', bg: '#dcfce7' },
  eligible:  { label: 'Not watched', color: '#92400e', bg: '#fef3c7' },
  forbidden: { label: 'Blocked',   color: '#991b1b', bg: '#fee2e2' },
  missing:   { label: 'Missing',   color: '#6b7280', bg: '#f3f4f6' },
};

export function SecurityPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [report, setReport] = useState<DeckSecurityReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { void buildDeckSecurityReport().then(setReport); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const eligibleCount = report?.rows.filter((r) => r.state === 'eligible').length ?? 0;

  const doApprove = async (referencePath: string) => {
    setBusy(true);
    try { setReport(await approveOne(referencePath)); } finally { setBusy(false); }
  };
  const doTrustAll = async () => {
    setBusy(true);
    try { await trustCurrentDeck(); refresh(); } finally { setBusy(false); }
  };

  return createPortal(
    <>
      {/* Light click-outside layer — dismisses, does not block (non-modal). */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.12)', zIndex: 9998 }} />
      <div style={{
        position: 'fixed', top: '8%', left: '50%', transform: 'translateX(-50%)',
        width: 640, maxWidth: '92vw', maxHeight: '84vh', overflow: 'auto',
        background: '#fff', borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
        zIndex: 9999, padding: 18, fontSize: 13, color: '#222',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Linked files & security</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#666' }}>×</button>
        </div>
        <p style={{ marginTop: 0, color: '#555', lineHeight: 1.4 }}>
          This deck links to files on your computer. Eigendeck reads them only after you
          approve them — until then it shows the copy embedded in the deck. Approve only
          files you recognize; check the <em>real target</em> shown for each.
        </p>

        {!report ? (
          <div style={{ color: '#999', padding: 12 }}>Scanning…</div>
        ) : report.rows.length === 0 ? (
          <div style={{ color: '#999', padding: 12 }}>This deck has no linked external files — everything is embedded.</div>
        ) : (
          <>
            {!report.trusted && eligibleCount > 0 && (
              <button onClick={doTrustAll} disabled={busy} style={primaryBtn}>
                Trust this deck &amp; watch all {eligibleCount} file{eligibleCount === 1 ? '' : 's'}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {report.rows.map((r) => {
                const st = STATE_STYLE[r.state];
                return (
                  <div key={r.assetId} style={{ border: '1px solid #eee', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.referencePath}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg }}>{st.label}</span>
                    </div>
                    {/* Resolved real target, shown in plain sight (the anti-disguise surface). */}
                    {r.resolvedPath && r.resolvedPath !== r.referencePath && (
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: r.state === 'forbidden' ? '#991b1b' : '#888', wordBreak: 'break-all', marginTop: 3 }}>
                        → {r.resolvedPath}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: '#999' }}>{r.usage}</span>
                      {r.reason && <span style={{ fontSize: 11, color: st.color }}>{r.reason}</span>}
                      <span style={{ flex: 1 }} />
                      {r.state === 'eligible' && (
                        <button onClick={() => doApprove(r.referencePath)} disabled={busy} style={smallBtn}>Approve</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ color: '#999', fontSize: 11, marginTop: 12, marginBottom: 0 }}>
              Blocked files aren’t a watchable type (e.g. not an image/PDF/video) and can’t be approved.
            </p>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 3, cursor: 'pointer',
};
