// Deck-wide asset-security window content (docs/ASSETS-SECURITY.md). Renders in its
// OWN Tauri window (security.html / security.tsx), which receives the deck via a
// `security:init` event. Shows one deck-status band (six cases), a loud Blocked band,
// and the linked files grouped by their real folder (tinted when a folder sits outside
// the deck's directory), each with its state, provenance, and per-file/per-folder
// actions. Deck trust and file approval are always two separate steps.
//
// Ledger writes happen here (shared appData); after any change we emit
// `eigendeck:security-changed` so the MAIN window (which owns the watcher) re-scans.
// Actions that must persist to the deck file (trust, watch-this-deck) or open the main
// window's Settings are routed to the main window by event (its store is the live deck).

import { useEffect, useState, useCallback, Fragment } from 'react';
import { emit } from '@tauri-apps/api/event';
import { usePresentationStore, getDeckToken } from '../store/presentation';
import {
  buildDeckSecurityReport, approveOne, approveDirectory, reconfirmThisDeck, revokeApproval,
  type DeckSecurityReport, type ExternalPathRow, type RowState,
} from '../lib/securityReport';
import { buildDemoNetReport, type DemoNetReportEntry } from '../lib/demoNetReport';
import { usePreference } from '../lib/preferences';
import { OVERRIDDEN_DIM, overriddenLabel } from '../lib/overriddenStyle';

const STATE_STYLE: Record<RowState, { label: string; color: string; bg: string }> = {
  approved:  { label: 'Watched',     color: '#166534', bg: '#dcfce7' },
  eligible:  { label: 'Not watched', color: '#92400e', bg: '#fef3c7' },
  forbidden: { label: 'Blocked',     color: '#991b1b', bg: '#fee2e2' },
  missing:   { label: 'Missing',     color: '#6b7280', bg: '#f3f4f6' },
};

// The "overridden by a higher-priority setting" motif (grey + strike + dim) is
// shared from ../lib/overriddenStyle so it reads identically here and in the
// inspector's watch/auto-reload controls. See docs/USER-FACING-MESSAGES.md.

type DeckCase = 'A' | 'B1' | 'B2' | 'C' | 'D' | 'E' | 'F';

// Which band to show, in precedence order: nothing linked → watching off (global wins
// over per-deck) → trust state.
function deckCase(r: DeckSecurityReport): DeckCase {
  if (r.rows.length === 0) return 'A';
  if (!r.watch.global) return 'B1';
  if (r.watch.deck === 'off') return 'B2';
  if (r.status === 'untrusted-ttl') return 'F';
  if (r.status === 'untrusted-new') return 'E';
  return r.trustReason === 'file-new' ? 'C' : 'D';
}

// Relative for the last week, absolute after.
function fmtWhen(at: number | null): string {
  if (!at) return '';
  const ms = Date.now() - at, day = 86_400_000;
  if (ms < 3_600_000) return 'just now';
  if (ms < day) { const h = Math.round(ms / 3_600_000); return h <= 1 ? '1 hour ago' : `${h} hours ago`; }
  if (ms < 7 * day) { const d = Math.round(ms / day); return d <= 1 ? 'yesterday' : `${d} days ago`; }
  return new Date(at).toLocaleDateString();
}
// Plain, accurate copy for a blocked row, keyed by WHY the gate rejected it. Most
// blocked files are benign (an older or hand-made file that isn't a recognized type),
// so this describes rather than accuses.
function blockedText(referencePath: string, reason: string | null): string {
  const ext = (referencePath.split('.').pop() || '').toUpperCase();
  const isHtml = ext === 'HTML';
  switch (reason) {
    case 'unsupported-demo-version':
      return 'This demo was built with a newer Eigendeck. Update Eigendeck to run it.';
    case 'bad-extension':
      return `Eigendeck doesn't load ${ext || 'this kind of'} files.`;
    case 'content-mismatch':
      return isHtml
        ? "Not a recognized Eigendeck demo (it may be an older or hand-made HTML file), so it won't run live."
        : `This file's contents don't match a ${ext || 'file'} of that type, so Eigendeck won't load it.`;
    default:
      return "Eigendeck can't use this file, so it won't be loaded.";
  }
}
function howLabel(reason: string | null): string {
  switch (reason) {
    case 'add': return 'added';
    case 'relocate': case 'relocate-folder': return 'relocated';
    case 'approve': return 'approved here';
    case 'approve-folder': return 'approved (whole folder)';
    case 'trusted': case 'trust-all': return 'trusted';
    default: return reason || '';
  }
}
// A resolved folder counts as "inside the deck" if it's the deck dir or below it.
function isInsideDeck(dir: string | null, projectDir: string): boolean {
  if (!projectDir || !dir) return true; // unknown → don't tint
  const base = projectDir.replace(/\/$/, '');
  return dir === base || dir.startsWith(base + '/');
}

export function SecurityWindowApp(): React.ReactElement {
  const [report, setReport] = useState<DeckSecurityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockNet, setBlockNet] = useState(false);
  const [netDemos, setNetDemos] = useState<DemoNetReportEntry[] | null>(null);
  // per-demo internet block: assetId → blocked. Layered under global + per-deck.
  const [demoBlocks, setDemoBlocks] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'files' | 'internet'>('files');
  // Global master switch (Settings → Security). OFF trumps everything: every
  // demo is offline regardless of the per-deck toggle, so the per-deck control
  // and the demo list render as OVERRIDDEN (disabled/struck), not as an active
  // choice. `effectiveBlocked` = what actually happens to this deck's demos.
  const [allowGlobal] = usePreference('demoInternetAccess');
  const globalOff = !allowGlobal;
  const effectiveBlocked = globalOff || blockNet;

  const refresh = useCallback(() => { void buildDeckSecurityReport().then(setReport); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { void buildDemoNetReport().then(setNetDemos); }, []);
  useEffect(() => {
    const token = getDeckToken();
    if (!token) return;
    void import('../lib/trustStore').then(async (m) => setBlockNet(await m.isDeckInternetBlocked(token)));
  }, [report]);
  // Load each listed demo's individual block state.
  useEffect(() => {
    const token = getDeckToken();
    if (!token || !netDemos) return;
    void import('../lib/trustStore').then(async (m) => {
      const pairs = await Promise.all(netDemos.map(async (d) => [d.assetId, await m.isDeckDemoBlocked(token, d.assetId)] as const));
      setDemoBlocks(Object.fromEntries(pairs));
    });
  }, [netDemos]);
  const notifyMain = () => { void emit('eigendeck:security-changed'); };

  // Toggle ONE demo's internet. `allow` true = let it reach its declared hosts.
  const doToggleDemo = async (assetId: string, allow: boolean) => {
    const token = getDeckToken();
    if (!token) return;
    setDemoBlocks((prev) => ({ ...prev, [assetId]: !allow }));
    const { setDeckDemoBlocked } = await import('../lib/trustStore');
    await setDeckDemoBlocked(token, assetId, !allow);
    notifyMain();
  };

  const doToggleBlockNet = async (blocked: boolean) => {
    const token = getDeckToken();
    if (!token) return;
    setBlockNet(blocked);
    const { setDeckInternetBlocked } = await import('../lib/trustStore');
    await setDeckInternetBlocked(token, blocked);
    notifyMain();
  };

  // Actions that mutate the live deck (trust, watch) must persist to the deck FILE, which
  // only the main window (whose store is the live deck) can do. We ask it over one
  // `security:request` channel; it runs the action, saves, and re-sends security:init —
  // which remounts this window (resetting `busy`). The setTimeout is only a fallback for
  // the (rare) case that reply never arrives. See App.tsx's security-request handler.
  const request = (action: 'trust' | 'watch' | 'open-settings') => emit('eigendeck:security-request', { action });
  const doTrust = async () => { setBusy(true); await request('trust'); setTimeout(() => setBusy(false), 4000); };
  const doWatchDeck = async () => { setBusy(true); await request('watch'); setTimeout(() => setBusy(false), 4000); };
  const doOpenSettings = () => { void request('open-settings'); };
  // Approve / revoke / reconfirm only write the shared ledger, so they run here directly.
  const doApprove = async (assetId: string, ref: string) => { setBusy(true); try { setReport(await approveOne(assetId, ref)); notifyMain(); } finally { setBusy(false); } };
  const doApproveDir = async (dir: string) => { setBusy(true); try { setReport(await approveDirectory(dir)); notifyMain(); } finally { setBusy(false); } };
  const doRevokeApproval = async (assetId: string) => { setBusy(true); try { setReport(await revokeApproval(assetId)); notifyMain(); } finally { setBusy(false); } };
  const doReconfirm = async () => { setBusy(true); try { setReport(await reconfirmThisDeck()); notifyMain(); } finally { setBusy(false); } };
  const doRevoke = async () => {
    const token = getDeckToken();
    if (!token) return;
    const title = usePresentationStore.getState().presentation.title || 'this deck';
    const approved = report?.counts.approved ?? 0;
    const { askConfirm } = await import('../lib/confirmDialog');
    const ok = await askConfirm(
      `Stop trusting "${title}"? Its linked files stop updating and all ${approved} approval${approved === 1 ? '' : 's'} are forgotten. The deck still displays fully using the embedded copies. You can trust it again later.`,
      { title: 'Stop trusting this deck', kind: 'warning', okLabel: 'Stop trusting', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    setBusy(true);
    try { const { revokeDeck } = await import('../lib/trustStore'); await revokeDeck(token); setReport(await buildDeckSecurityReport()); notifyMain(); }
    finally { setBusy(false); }
  };

  const kase = report ? deckCase(report) : null;
  // File actions (approve / revoke) apply only on a trusted deck that's actually
  // watching. On B1/B2 (watching off) the files are listed read-only.
  const canAct = !!report?.trusted && kase !== 'B1' && kase !== 'B2';

  return (
    <div style={{ padding: 20, maxWidth: 780, margin: '0 auto' }}>
      {/* No in-content title or × — this is a dialog-style window; the OS window
          title + native close button are the single title / close affordance. */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <SecTabBtn active={tab === 'files'} onClick={() => setTab('files')}>Linked files</SecTabBtn>
        <SecTabBtn active={tab === 'internet'} onClick={() => setTab('internet')}>Internet</SecTabBtn>
      </div>

      {tab === 'files' && (
        <>
          <p style={{ marginTop: 0, color: '#555', lineHeight: 1.45, fontSize: 13 }}>
            Eigendeck can keep this deck's images, demos, and notebooks linked to files on your
            computer so they update as you edit them. That means reading those files. So it only
            does that for decks you trust, and only for files you approve.
          </p>
          <p style={{ marginTop: -4, color: '#111', fontSize: 12, fontWeight: 600 }}>
            You never need to trust a deck just to view it. Every asset is already embedded.
            Trust only affects whether linked files stay live.
          </p>

          {!report || !kase ? (
            <div style={{ color: '#999', padding: 12 }}>Scanning…</div>
          ) : (
            <>
              <StatusBand kase={kase} report={report} busy={busy}
                onTrust={doTrust} onReconfirm={doReconfirm} onWatchDeck={doWatchDeck} onOpenSettings={doOpenSettings} />

              {report.counts.blocked > 0 && <BlockedBand n={report.counts.blocked} />}

              {kase !== 'A' && (
                <>
                  <CountsHeader counts={report.counts} />
                  <GroupedRows report={report} canAct={canAct} busy={busy}
                    onApprove={doApprove} onApproveDir={doApproveDir} onRevokeApproval={doRevokeApproval} />
                </>
              )}

              {/* Deck-level action bar. Stop-trusting is deliberately separate from per-file
                  revoke, and guards on a native confirm (see doRevoke). */}
              <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                {report.trusted && <button onClick={doRevoke} disabled={busy} className="chip-btn danger" style={dangerBtn}>Stop trusting this deck</button>}
                <span style={{ flex: 1 }} />
                <button onClick={() => { void import('@tauri-apps/plugin-opener').then((m) => m.openUrl('https://eigendeck.dev/manual/security')).catch(() => {}); }}
                  style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: 11, cursor: 'pointer' }}>
                  Learn about deck security
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'internet' && (
        <>
          <p style={{ marginTop: 0, color: '#555', lineHeight: 1.45, fontSize: 13 }}>
            Demos are the little interactive web widgets in this deck's slides — charts,
            simulations, graphs. They run in a sandbox and <strong>can't open, read, or change
            your files.</strong> Some fetch live data from the internet.
          </p>
          {globalOff && (
            <div style={{ border: '1px solid #fca5a5', background: '#fee2e2', borderRadius: 6, padding: '10px 12px', marginTop: 12, color: '#991b1b', fontSize: 12.5, lineHeight: 1.5 }}>
              <b>Demo internet is off for every deck.</b> You turned off <i>Let demos use the
              internet</i> in Settings → Security, so all demos here are offline. The per-deck
              control below has no effect until you turn it back on.
            </div>
          )}
          <div style={{ borderTop: '1px solid #eee', marginTop: 12, paddingTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: globalOff ? 'default' : 'pointer', opacity: globalOff ? OVERRIDDEN_DIM : 1 }}>
              <input type="checkbox" checked={blockNet} disabled={globalOff}
                onChange={(e) => void doToggleBlockNet(e.target.checked)} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, ...(globalOff ? overriddenLabel : {}) }}>Block internet access for this deck's demos</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  Demos still run, just offline — they can't fetch live data or phone home
                  (for example, tracking when and where you open this deck). Use this for a
                  deck from someone you don't fully trust.
                </div>
              </div>
            </label>
          </div>
          {!globalOff && (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 14 }}>
              There's also an app-wide switch in Settings → Security. Turning demo internet off
              there blocks it for every deck, overriding this per-deck choice.
            </p>
          )}

          <DemoNetList demos={netDemos} deckBlocked={effectiveBlocked} globalOff={globalOff}
            demoBlocks={demoBlocks} onToggle={doToggleDemo} />
        </>
      )}
    </div>
  );
}

// The per-demo declared-network list. A demo declares which hosts it reaches and
// why (its manifest); we surface that so "what phones home, and for what" is legible.
// Undeclared demos get no internet, so they aren't listed (nothing to disclose).
function slidesLabel(slides: number[]): string {
  const s = slides.length === 1 ? 'Slide' : 'Slides';
  return `${s} ${slides.join(', ')}`;
}
function DemoNetList({ demos, deckBlocked, globalOff, demoBlocks, onToggle }: {
  demos: DemoNetReportEntry[] | null; deckBlocked: boolean; globalOff: boolean;
  demoBlocks: Record<string, boolean>; onToggle: (assetId: string, allow: boolean) => void;
}): React.ReactElement | null {
  if (demos === null) {
    return <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16 }}>Checking demos…</div>;
  }
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid #eee', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        What this deck's demos reach
      </div>
      {demos.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          No demo in this deck declares any internet access, so none of them go online.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
            These demos declare the hosts they connect to and why. A demo can only reach the
            hosts it lists here — anything else is blocked. Turn any one off individually.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {demos.map((d) => {
              const perDemoBlocked = !!demoBlocks[d.assetId];
              const eff = deckBlocked || perDemoBlocked;     // is this demo offline?
              // The per-demo toggle only matters while the deck+global allow internet;
              // once those block everything it's overridden (disabled).
              const overridden = deckBlocked;
              const chip = overridden ? (globalOff ? 'Off globally' : 'Off for this deck')
                : (perDemoBlocked ? 'Off' : null);
              return (
                <div key={d.assetId} style={{
                  border: '1px solid #eef2f7', borderRadius: 6, padding: '8px 10px',
                  background: eff ? '#f8fafc' : '#fff', opacity: overridden ? OVERRIDDEN_DIM : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{slidesLabel(d.slides)}</span>
                    {chip && (
                      <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 10, color: '#991b1b', background: '#fee2e2' }}>
                        {chip}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {/* Per-demo switch: checked = this demo may use the internet. */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                      cursor: overridden ? 'default' : 'pointer',
                      ...(overridden ? overriddenLabel : { color: '#374151' }) }}>
                      <input type="checkbox" checked={!eff} disabled={overridden}
                        onChange={(e) => onToggle(d.assetId, e.target.checked)} />
                      Allow internet
                    </label>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {d.hosts.map((h) => (
                      <div key={h.host} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                        <span style={{
                          fontFamily: 'monospace', fontSize: 11.5, color: eff ? '#9ca3af' : '#111827',
                          textDecoration: eff ? 'line-through' : 'none', wordBreak: 'break-all', flexShrink: 0,
                        }}>{h.host}</span>
                        <span style={{ color: '#6b7280', fontSize: 11.5 }}>{h.purpose || 'no purpose given'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SecTabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}): React.ReactElement {
  return (
    <button onClick={onClick}
      style={{
        padding: '9px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 600 : 400,
        color: active ? '#111827' : '#6b7280',
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
        marginBottom: -1,
      }}>
      {children}
    </button>
  );
}

function StatusBand({ kase, report, busy, onTrust, onReconfirm, onWatchDeck, onOpenSettings }: {
  kase: DeckCase; report: DeckSecurityReport; busy: boolean;
  onTrust: () => void; onReconfirm: () => void; onWatchDeck: () => void; onOpenSettings: () => void;
}): React.ReactElement {
  const { counts, trustedAt } = report;
  const box = (bg: string, border: string, color: string, body: React.ReactNode, action?: React.ReactNode) => (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 6, padding: '10px 12px', marginBottom: 12, color }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{body}</div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
  switch (kase) {
    case 'A':
      return box('#f8fafc', '#e5e7eb', '#374151',
        <><b>Nothing to manage.</b> This deck is fully self-contained. Nothing links to files on your computer, so there's nothing to trust or watch.</>);
    case 'B1':
      return box('#f8fafc', '#e5e7eb', '#374151',
        <><b>File watching is off for all decks.</b> You turned off <i>Watch source files</i> in Settings, so linked files never update live. Every deck stays a self-contained copy.</>,
        <button onClick={onOpenSettings} className="chip-btn" style={secondaryBtn}>Open Settings…</button>);
    case 'B2':
      return box('#f8fafc', '#e5e7eb', '#374151',
        <><b>File watching is off for this deck.</b> You turned it off for this presentation, so its linked files never update live. It stays a self-contained copy. Other decks are unaffected.</>,
        <button onClick={onWatchDeck} disabled={busy} className="chip-btn" style={secondaryBtn}>Watch files for this deck</button>);
    case 'C':
      return box('#ecfdf5', '#a7f3d0', '#065f46',
        <><b>You created this deck, so it's trusted.</b> Its linked files are watched by default.{trustedAt ? ` Trusted ${fmtWhen(trustedAt)}, created here.` : ''}</>);
    case 'D':
      return box('#ecfdf5', '#a7f3d0', '#065f46',
        <><b>You trust this deck.</b>{trustedAt ? ` Trusted ${fmtWhen(trustedAt)}.` : ''} Any files added or changed since then are listed below for approval.</>);
    case 'E':
      return box('#fffbeb', '#fde68a', '#92400e',
        <><b>This deck isn't trusted.</b> You got it from somewhere else. It displays right now, using copies embedded in the deck. Its {counts.total} link{counts.total === 1 ? '' : 's'} to files on your computer stay off until you trust it. Trusting reads nothing by itself. You then choose which files to watch.</>,
        <button onClick={onTrust} disabled={busy} className="chip-btn primary" style={primaryBtn}>Trust this deck</button>);
    case 'F':
      return box('#fffbeb', '#fde68a', '#92400e',
        <><b>This deck's trust expired.</b>{trustedAt ? ` You trusted it ${fmtWhen(trustedAt)},` : ' You trusted it earlier,'} but it's been dormant about 30 days, so watching is paused. Your {counts.approved} previous approval{counts.approved === 1 ? '' : 's'} {counts.approved === 1 ? 'is' : 'are'} remembered. Re-confirm to resume.</>,
        <button onClick={onReconfirm} disabled={busy} className="chip-btn primary" style={primaryBtn}>Re-confirm to resume watching</button>);
  }
}

function BlockedBand({ n }: { n: number }): React.ReactElement {
  return (
    <div style={{ border: '1px solid #fca5a5', background: '#fee2e2', borderRadius: 6, padding: '10px 12px', marginBottom: 12, color: '#991b1b' }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        <b>⚠ {n} linked file{n === 1 ? '' : 's'} can't be used by Eigendeck, so {n === 1 ? "it won't" : "they won't"} be loaded.</b> This
        usually means an older or unrecognized file. Occasionally it means a link points somewhere unexpected. Review the ⚠ rows below.
      </div>
    </div>
  );
}

function CountsHeader({ counts }: { counts: DeckSecurityReport['counts'] }): React.ReactElement {
  const parts = [`${counts.approved} watched`, `${counts.eligible} not watched`];
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);
  if (counts.missing) parts.push(`${counts.missing} missing`);
  return (
    <div style={{ fontSize: 12, color: '#374151', margin: '2px 0 8px', fontWeight: 600 }}>
      {counts.total} linked file{counts.total === 1 ? '' : 's'}. <span style={{ fontWeight: 400, color: '#6b7280' }}>{parts.join(' · ')}</span>
    </div>
  );
}

// Explains the "unused" badge in-place: a linked file on no slide is kept for undo and
// cleared by compacting. Shown via InfoTip next to the badge (see Row).
const UNUSED_TOOLTIP =
  "This file isn't used on any slide. It's kept so you can undo, and removed when you "
  + 'compact the deck: File → Compact (Free Unused Assets).';

// Small "i" info icon with a hover tooltip. Rolls its own tooltip (React state) rather
// than the native `title` attribute, which doesn't fire reliably in Tauri's WebKit, and
// draws the icon with CSS (a bordered "i") instead of a Unicode glyph like ⓘ that the
// window's font renders as a "?".
function InfoTip({ text }: { text: string }): React.ReactElement {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 5 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 13, height: 13, borderRadius: '50%', border: '1px solid #9ca3af',
        color: '#6b7280', fontSize: 9, fontStyle: 'italic', fontWeight: 700,
        fontFamily: 'Georgia, "Times New Roman", serif', cursor: 'help', userSelect: 'none',
      }}>i</span>
      {show && (
        <span style={{
          position: 'absolute', top: '150%', left: 0, zIndex: 50, width: 240,
          background: '#111827', color: '#fff', fontSize: 11, lineHeight: 1.4,
          padding: '7px 9px', borderRadius: 5, boxShadow: '0 2px 10px rgba(0,0,0,.35)',
          fontStyle: 'normal', fontWeight: 400, pointerEvents: 'none',
        }}>{text}</span>
      )}
    </span>
  );
}

// Render a path so it wraps at '/' separators (a <wbr> after each slash) rather
// than mid-segment. Pair with `overflow-wrap: anywhere` so an over-long single
// segment can still break as a last resort.
function PathText({ path }: { path: string }): React.ReactElement {
  const segs = path.split('/');
  return (
    <>
      {segs.map((seg, i) => (
        <Fragment key={i}>{i > 0 ? <>/<wbr /></> : null}{seg}</Fragment>
      ))}
    </>
  );
}

function GroupedRows({ report, canAct, busy, onApprove, onApproveDir, onRevokeApproval }: {
  report: DeckSecurityReport; canAct: boolean; busy: boolean;
  onApprove: (assetId: string, ref: string) => void; onApproveDir: (dir: string) => void; onRevokeApproval: (assetId: string) => void;
}): React.ReactElement {
  // Group by resolved folder; unresolved rows (blocked / missing) share one group.
  const groups = new Map<string, ExternalPathRow[]>();
  for (const r of report.rows) {
    const key = r.resolvedDir ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  // Trusted-but-can't-act == watching is off (global or per-deck) — the per-file
  // controls are OVERRIDDEN by that higher-priority switch, so dim the list (motif).
  const watchingOff = !!report.trusted && !canAct;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: watchingOff ? OVERRIDDEN_DIM : 1 }}>
      {[...groups.entries()].map(([dir, rows]) => {
        const outside = dir !== '' && !isInsideDeck(dir, report.projectDir);
        const eligibleHere = rows.filter((r) => r.state === 'eligible');
        return (
          <div key={dir || '(unresolved)'} style={{
            border: `1px solid ${outside ? '#fde68a' : '#eee'}`,
            background: outside ? '#fffbeb' : 'transparent',
            borderRadius: 6, padding: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {/* The folder is the headline (bigger). Its files are listed under
                  it as descendants (↳ + filename) so the full path isn't repeated
                  per row. */}
              <span style={{ fontSize: 13, fontWeight: 600, color: outside ? '#92400e' : '#374151', overflowWrap: 'anywhere' }}>
                <span style={{ fontFamily: 'monospace' }}><PathText path={dir || 'Unresolved links'} /></span>
                {outside && (
                  <span style={{ fontWeight: 400, fontStyle: 'italic', fontSize: 12, whiteSpace: 'nowrap' }}> · outside the deck folder</span>
                )}
              </span>
              <span style={{ flex: 1 }} />
              {/* Batch approve — only when there's more than one eligible file
                  (a single file's own Approve button already covers it). Kept
                  deliberately subtle so it blends into the folder band (amber on
                  the outside-the-deck warning band, gray otherwise) rather than
                  competing with the per-file Approve chips. */}
              {canAct && eligibleHere.length > 1 && dir && (
                <button onClick={() => onApproveDir(dir)} disabled={busy}
                  title={`Approve all ${eligibleHere.length} eligible files in this folder at once`}
                  style={{
                    padding: '2px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 4,
                    background: 'transparent',
                    border: '1px solid ' + (outside ? '#fcd34d' : '#e5e7eb'),
                    color: outside ? '#92400e' : '#6b7280',
                  }}>
                  Approve all {eligibleHere.length} files
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((r) => <Row key={r.assetId} r={r} outside={outside} canAct={canAct} trusted={!!report.trusted} busy={busy} onApprove={onApprove} onRevokeApproval={onRevokeApproval} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ r, outside, canAct, trusted, busy, onApprove, onRevokeApproval }: {
  r: ExternalPathRow; outside: boolean; canAct: boolean; trusted: boolean; busy: boolean;
  onApprove: (assetId: string, ref: string) => void; onRevokeApproval: (assetId: string) => void;
}): React.ReactElement {
  const st = STATE_STYLE[r.state];
  return (
    // No stark white card — a subtle tint that sits gently on the folder band
    // (a touch warmer than the amber warning band, near-transparent otherwise)
    // so the list reads calmly instead of as high-contrast white boxes.
    <div style={{
      border: '1px solid ' + (outside ? '#fbe6b3' : '#eef0f2'),
      borderRadius: 5, padding: '8px 10px',
      background: outside ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.015)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        {/* Just the file name, as a child of the folder headline above (↳). The
            folder already carries the full real path, so we don't repeat it; the
            authored ../-relative referencePath is never surfaced. Unresolved rows
            (no resolved path) fall back to the reference. */}
        <span style={{ fontFamily: 'monospace', fontSize: 11.5, overflowWrap: 'anywhere', color: '#374151' }}>
          <span style={{ color: '#9ca3af', marginRight: 5, fontFamily: 'system-ui' }}>↳</span>
          <PathText path={r.resolvedPath ? (r.resolvedPath.split('/').pop() || r.resolvedPath) : r.referencePath} />
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg }}>{st.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
        <span style={{ fontSize: 11, color: '#999', display: 'inline-flex', alignItems: 'center' }}>
          {r.usage}
          {r.usage === 'unused' && <InfoTip text={UNUSED_TOOLTIP} />}
        </span>
        {r.state === 'approved' && r.approvedAt && (
          <span style={{ fontSize: 11, color: st.color }}>Approved {fmtWhen(r.approvedAt)} · {howLabel(r.approvedHow)}</span>
        )}
        {r.state === 'forbidden' && <span style={{ fontSize: 11, color: st.color }}>{blockedText(r.referencePath, r.reason)}</span>}
        {r.state === 'missing' && <span style={{ fontSize: 11, color: st.color }}>Source file not found on disk. Eigendeck is showing the last saved copy.</span>}
        <span style={{ flex: 1 }} />
        {r.state === 'approved' && canAct && (
          <button onClick={() => onRevokeApproval(r.assetId)} disabled={busy} className="chip-btn danger" style={ghostBtn}>Revoke approval</button>
        )}
        {r.state === 'eligible' && (
          canAct
            ? <button onClick={() => onApprove(r.assetId, r.referencePath)} disabled={busy} className="chip-btn primary" style={smallBtn}>Approve</button>
            : trusted
              ? <span style={{ fontSize: 11, ...overriddenLabel }}>watching is off</span>
              : <span style={{ fontSize: 11, color: '#999' }}>trust the deck first</span>
        )}
      </div>
    </div>
  );
}

// Size-only overrides layered on the shared chip classes (chip.css). Visual
// look (bg/border/shadow) comes from `.chip-btn` (+ .primary / .danger).
const primaryBtn: React.CSSProperties = { padding: '7px 14px', fontSize: 13 };
const secondaryBtn: React.CSSProperties = { padding: '5px 12px', fontSize: 12 };
const smallBtn: React.CSSProperties = { padding: '3px 10px', fontSize: 11, textAlign: 'left' };
const ghostBtn: React.CSSProperties = { padding: '3px 10px', fontSize: 11 };
const dangerBtn: React.CSSProperties = { padding: '5px 12px', fontSize: 12 };
