// Topbar pill that aggregates the connection health of registered
// Jupyter servers against the kernels the open deck actually needs.
//
// Design notes (per the user's directive "no UX in the notebook
// element"):
//   - The pill is the ONLY surface that surfaces server status to
//     the presenter. Notebook elements stay quiet.
//   - During PresentMode the pill hides entirely — the presenter has
//     already verified green; cluttering the present view isn't
//     helpful.
//   - Hidden when the deck has zero notebook elements (no reason to
//     advertise server status if none are needed).
//
// Health levels:
//   green:  every kernel the deck needs has a matching server that
//           was reached recently (≤ 30 min).
//   yellow: kernels matched but staleness > 30 min — server might
//           or might not still be up. Click "Test all" to refresh.
//   red:    at least one kernel needed by the deck has no matching
//           server in the registry.
//   hidden: no notebook elements OR PresentMode active.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresentationStore } from '../store/presentation';
import { usePreference, type JupyterServerEntry } from '../lib/preferences';
import { findServerForKernel } from '../lib/notebookKernel';
import { deckExternalKernels } from '../lib/serverHealth';

const STALE_MS = 30 * 60 * 1000;

type Health = 'green' | 'yellow' | 'red';

interface ServerCheck {
  /** Original entry from the registry. */
  entry: JupyterServerEntry;
  /** Health derived from lastSeenAt. */
  health: 'green' | 'yellow' | 'gray';
}

interface DeckRequirement {
  /** Requested kernel name (e.g. 'python3'). */
  kernelName: string;
  /** Which registered server (if any) advertises it. */
  matched: JupyterServerEntry | null;
}

export function ServerStatusPill() {
  const isPresenting = usePresentationStore((s) => s.isPresenting);
  const slides = usePresentationStore((s) => s.presentation?.slides ?? []);
  const config = usePresentationStore((s) => s.presentation?.config);
  const [servers, setServers] = usePreference('jupyterServers');
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  // Unique kernel names the deck's notebooks need, then a registry lookup per
  // kernel so we can flag missing matches. Per-element resolution (parsing each
  // notebook for its declared kernel) happens lazily inside NotebookContent;
  // here we use the element-level value, then the deck default, then 'python3'.
  const deckKernels = useMemo(() => deckExternalKernels(slides, config), [slides, config]);

  const requirements: DeckRequirement[] = useMemo(() => {
    return deckKernels.map((kernelName) => ({
      kernelName,
      matched: findServerForKernel(kernelName, servers),
    }));
  }, [deckKernels, servers]);

  // Hide entirely when not relevant.
  if (isPresenting) return null;
  if (deckKernels.length === 0) return null;

  // Aggregate health.
  const missing = requirements.filter((r) => r.matched == null);
  const needed = new Set(requirements.map((r) => r.matched).filter(Boolean) as JupyterServerEntry[]);
  const serverChecks: ServerCheck[] = [...needed].map((entry) => ({
    entry, health: serverHealth(entry),
  }));

  let health: Health;
  if (missing.length > 0) {
    health = 'red';
  } else if (serverChecks.every((c) => c.health === 'green')) {
    health = 'green';
  } else {
    health = 'yellow';
  }

  const togglePopover = () => {
    if (open) { setOpen(false); return; }
    const rect = pillRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({ left: rect.left, top: rect.bottom + 6 });
    }
    setOpen(true);
  };

  const refreshAll = async () => {
    const updated = await Promise.all(servers.map(async (s) => {
      try {
        const url = s.baseUrl.replace(/\/$/, '');
        const q = s.token ? `?token=${encodeURIComponent(s.token)}` : '';
        const r = await fetch(`${url}/api/kernelspecs${q}`, {
          headers: s.token ? { Authorization: `token ${s.token}` } : {},
        });
        if (!r.ok) return s;
        const data = await r.json();
        const kernels = Object.keys(data.kernelspecs ?? {});
        return { ...s, availableKernels: kernels, lastSeenAt: Date.now() };
      } catch {
        return s;
      }
    }));
    setServers(updated);
  };

  return (
    <>
      <div
        ref={pillRef}
        className={`server-pill server-pill-${health}`}
        onClick={togglePopover}
        title="Jupyter server status (click for details)"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '2px 10px', fontSize: 12,
          borderRadius: 12, cursor: 'pointer', userSelect: 'none',
          border: '1px solid', whiteSpace: 'nowrap',
          ...pillColors(health),
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(health) }} />
        Servers {countLabel(serverChecks, missing.length)}
      </div>

      {open && anchor && createPortal(
        <PillDropdown
          requirements={requirements}
          serverChecks={serverChecks}
          missing={missing}
          anchor={anchor}
          onClose={() => setOpen(false)}
          onRefresh={refreshAll}
        />,
        document.body,
      )}
    </>
  );
}

function PillDropdown({
  requirements, serverChecks, missing, anchor, onClose, onRefresh,
}: {
  requirements: DeckRequirement[];
  serverChecks: ServerCheck[];
  missing: DeckRequirement[];
  anchor: { left: number; top: number };
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);

  // Click-outside dismiss.
  useEffect(() => {
    const handler = () => onClose();
    // Fire on next-tick so the click that OPENED the dropdown
    // doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', handler); };
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: anchor.left, top: anchor.top,
        background: '#fff', border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        minWidth: 320, maxWidth: 480,
        padding: 12,
        zIndex: 10000,
        fontSize: 12, color: '#111827',
      }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        Jupyter servers needed by this deck
      </div>

      {requirements.map((r, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
          borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
        }}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#374151', minWidth: 90 }}>
            {r.kernelName}
          </span>
          {r.matched ? (
            <>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(rowHealth(r.matched)) }} />
              <span style={{ fontSize: 11, color: '#374151' }}>{r.matched.label}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>
                {r.matched.lastSeenAt ? `seen ${timeAgo(r.matched.lastSeenAt)}` : 'never tested'}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: '#b91c1c' }}>
              no registered server advertises this kernel
            </span>
          )}
        </div>
      ))}

      {missing.length > 0 && (
        <div style={{
          marginTop: 10, padding: 8, fontSize: 11, color: '#6b7280',
          background: '#fef2f2', borderRadius: 4, border: '1px solid #fecaca',
        }}>
          Open <strong>Settings → Jupyter servers</strong> to add a server that advertises {missing.map(m => m.kernelName).join(', ')}.
        </div>
      )}

      {serverChecks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={async () => {
            setRefreshing(true);
            try { await onRefresh(); } finally { setRefreshing(false); }
          }} disabled={refreshing}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: '#fff', border: '1px solid #d1d5db', borderRadius: 3,
              cursor: refreshing ? 'wait' : 'pointer',
            }}>
            {refreshing ? 'Refreshing…' : 'Refresh all'}
          </button>
        </div>
      )}
    </div>
  );
}

function serverHealth(s: JupyterServerEntry): 'green' | 'yellow' | 'gray' {
  if (!s.lastSeenAt) return 'gray';
  const age = Date.now() - s.lastSeenAt;
  if (age < STALE_MS) return 'green';
  return 'yellow';
}

function rowHealth(s: JupyterServerEntry): 'green' | 'yellow' | 'gray' {
  return serverHealth(s);
}

function dotColor(h: Health | 'gray'): string {
  switch (h) {
    case 'green': return '#10b981';
    case 'yellow': return '#f59e0b';
    case 'red': return '#dc2626';
    case 'gray': return '#9ca3af';
  }
}

function pillColors(h: Health): React.CSSProperties {
  switch (h) {
    case 'green': return { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' };
    case 'yellow': return { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' };
    case 'red': return { background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' };
  }
}

function countLabel(checks: ServerCheck[], missingCount: number): string {
  const green = checks.filter((c) => c.health === 'green').length;
  const total = checks.length;
  if (missingCount > 0) return `${green}/${total + missingCount}`;
  return `${green}/${total}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
