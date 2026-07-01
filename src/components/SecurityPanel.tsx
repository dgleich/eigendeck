// Deck-wide asset-security window content (docs/ASSETS-SECURITY.md). Renders in its
// OWN Tauri window (security.html / security.tsx), which receives the deck via a
// `security:init` event. Lists every external file the deck links, its RESOLVED real
// target (plain sight), where it's used, and its state (approved/eligible/forbidden/
// missing), with per-path Approve and a trust-all action. Forbidden rows are shown
// (see what a deck tried to reach) but never approvable.
//
// Ledger writes happen here (shared appData); after any change we emit
// `eigendeck:security-changed` so the MAIN window (which owns the watcher) re-scans.

import { useEffect, useState, useCallback } from 'react';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildDeckSecurityReport, approveOne, trustAllCurrent, type DeckSecurityReport, type RowState } from '../lib/securityReport';

const STATE_STYLE: Record<RowState, { label: string; color: string; bg: string }> = {
  approved:  { label: 'Watched',     color: '#166534', bg: '#dcfce7' },
  eligible:  { label: 'Not watched', color: '#92400e', bg: '#fef3c7' },
  forbidden: { label: 'Blocked',     color: '#991b1b', bg: '#fee2e2' },
  missing:   { label: 'Missing',     color: '#6b7280', bg: '#f3f4f6' },
};

export function SecurityWindowApp(): React.ReactElement {
  const [report, setReport] = useState<DeckSecurityReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { void buildDeckSecurityReport().then(setReport); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const notifyMain = () => { void emit('eigendeck:security-changed'); };

  const eligibleCount = report?.rows.filter((r) => r.state === 'eligible').length ?? 0;

  const doApprove = async (referencePath: string) => {
    setBusy(true);
    try { setReport(await approveOne(referencePath)); notifyMain(); } finally { setBusy(false); }
  };
  const doTrustAll = async () => {
    setBusy(true);
    try { setReport(await trustAllCurrent()); notifyMain(); } finally { setBusy(false); }
  };
  const closeWindow = () => { void getCurrentWebviewWindow().close(); };

  return (
    <div style={{ padding: 20, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Linked files &amp; security</h1>
        <button onClick={closeWindow} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: '#666' }}>×</button>
      </div>
      <p style={{ marginTop: 0, color: '#555', lineHeight: 1.45 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {report.rows.map((r) => {
              const st = STATE_STYLE[r.state];
              return (
                <div key={r.assetId} style={{ border: '1px solid #eee', borderRadius: 6, padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.referencePath}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg }}>{st.label}</span>
                  </div>
                  {r.resolvedPath && r.resolvedPath !== r.referencePath && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: r.state === 'forbidden' ? '#991b1b' : '#888', wordBreak: 'break-all', marginTop: 3 }}>
                      → {r.resolvedPath}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
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
          <p style={{ color: '#999', fontSize: 11, marginTop: 14 }}>
            Blocked files aren’t a watchable type (e.g. not an image/PDF/video) and can’t be approved.
          </p>
        </>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 13, background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 3, cursor: 'pointer',
};
