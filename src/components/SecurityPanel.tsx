// Deck-wide asset-security window content (docs/ASSETS-SECURITY.md). Renders in its
// OWN Tauri window (security.html / security.tsx), which receives the deck via a
// `security:init` event. Lists every external file the deck links, its RESOLVED real
// target (plain sight), where it's used, and its state (approved/eligible/forbidden/
// missing). Two separate steps, never combined: a deck-level "Trust this deck" (shown
// while untrusted; reads nothing), then per-file / per-folder Approve. Forbidden rows
// are shown (see what a deck tried to reach) but never approvable.
//
// Ledger writes happen here (shared appData); after any change we emit
// `eigendeck:security-changed` so the MAIN window (which owns the watcher) re-scans.

import { useEffect, useState, useCallback } from 'react';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { usePresentationStore } from '../store/presentation';
import { buildDeckSecurityReport, approveOne, approveDirectory, type DeckSecurityReport, type RowState } from '../lib/securityReport';

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

  // TWO SEPARATE steps, never combined (docs/ASSETS-SECURITY.md):
  //   1. Trust the deck — a deck-level decision that unlocks watching + approval and
  //      reads NOTHING on its own.
  //   2. Approve files — only after the deck is trusted; per file OR a whole folder.
  const doTrust = async () => {
    // The Security window has its OWN store copy — trusting here wouldn't reach the
    // deck file or the main window. Ask the main window (which owns the deck + saves it)
    // to mint+record+SAVE trust; it re-sends security:init, remounting this window with
    // the now-trusted deck. See App.tsx 'eigendeck:security-trust-request'.
    setBusy(true);
    await emit('eigendeck:security-trust-request');
    // Fallback: if no re-init arrives (e.g. main window busy), un-stick the button.
    setTimeout(() => setBusy(false), 4000);
  };
  const doApprove = async (assetId: string, referencePath: string) => {
    setBusy(true);
    try { setReport(await approveOne(assetId, referencePath)); notifyMain(); } finally { setBusy(false); }
  };
  const doApproveDir = async (dir: string) => {
    setBusy(true);
    try { setReport(await approveDirectory(dir)); notifyMain(); } finally { setBusy(false); }
  };
  // Stop trusting: drops trust AND every approval for this deck. Unlike trusting
  // (which mints + SAVES a token to the deck file, so it must go through the main
  // window), revoke only writes the shared appData ledger — so it persists from
  // here directly. The still-live watcher's next read is then gated off (untrusted
  // → snapshot only). notifyMain re-scans + refreshes the sidebar.
  const doRevoke = async () => {
    const token = usePresentationStore.getState().presentation.config.deckToken;
    if (!token) return;
    const title = usePresentationStore.getState().presentation.title || 'this deck';
    const approved = report?.rows.filter((r) => r.state === 'approved').length ?? 0;
    const { askConfirm } = await import('../lib/confirmDialog');
    const ok = await askConfirm(
      `Stop trusting "${title}"? Its linked files stop updating and all ${approved} approval${approved === 1 ? '' : 's'} are forgotten. The deck still displays fully using the embedded copies. You can trust it again later.`,
      { title: 'Stop trusting this deck', kind: 'warning', okLabel: 'Stop trusting', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { revokeDeck } = await import('../lib/trustStore');
      await revokeDeck(token);
      setReport(await buildDeckSecurityReport());
      notifyMain();
    } finally { setBusy(false); }
  };
  const closeWindow = () => { void getCurrentWebviewWindow().close(); };

  // Eligible files grouped by their resolved folder, for the per-folder bulk approve.
  const eligibleDirs: Array<[string, number]> = report
    ? Object.entries(report.rows.reduce<Record<string, number>>((m, r) => {
        if (r.state === 'eligible' && r.resolvedDir) m[r.resolvedDir] = (m[r.resolvedDir] ?? 0) + 1;
        return m;
      }, {}))
    : [];

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
          {/* Step 1 — trust the deck. Distinct from approving files; reads nothing. */}
          {!report.trusted && (
            <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#92400e', marginBottom: 8 }}>
                This deck isn’t trusted, so Eigendeck isn’t reading any of these files — you’re
                seeing the embedded copies. Trust the deck to <em>choose</em> which files it may
                read &amp; watch. Trusting reads nothing on its own; you approve files next.
              </div>
              <button onClick={doTrust} disabled={busy} style={primaryBtn}>Trust this deck</button>
            </div>
          )}

          {/* Step 2 — approve files, per folder or per file (trusted decks only). */}
          {report.trusted && eligibleDirs.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>Approve a whole folder:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {eligibleDirs.map(([dir, n]) => (
                  <button key={dir} onClick={() => doApproveDir(dir)} disabled={busy}
                    style={{ ...smallBtn, alignSelf: 'flex-start', textAlign: 'left' }}
                    title={dir}>
                    Approve all {n} file{n === 1 ? '' : 's'} in <span style={{ fontFamily: 'monospace' }}>{dir}</span>
                  </button>
                ))}
              </div>
            </div>
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
                      report.trusted
                        ? <button onClick={() => doApprove(r.assetId, r.referencePath)} disabled={busy} style={smallBtn}>Approve</button>
                        : <span style={{ fontSize: 11, color: '#999' }}>trust the deck first</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ color: '#999', fontSize: 11, marginTop: 14 }}>
            Blocked files aren’t a watchable type (e.g. not an image/PDF/video) and can’t be approved.
          </p>
          {report.trusted && (
            <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 12 }}>
              <button onClick={doRevoke} disabled={busy} style={dangerBtn}>Stop trusting this deck</button>
              <span style={{ fontSize: 11, color: '#999', marginLeft: 10 }}>
                Forgets trust and all approvals; linked files stop updating. The deck still displays (embedded copies).
              </span>
            </div>
          )}
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
const dangerBtn: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, background: '#fff', color: '#991b1b',
  border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer',
};
