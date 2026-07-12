// Global application preferences modal. Opened from the Eigendeck menu
// (Settings…, Cmd+,). Tabbed: "General" for the asset auto-reload toggle,
// default text sizes, and default LaTeX preamble; "Jupyter servers" for
// the per-machine kernel-server registry. Per-presentation and per-asset
// overrides live in the Inspector — this is for app-wide defaults.
//
// This is a webview-based modal; native settings window is tracked in
// https://github.com/dgleich/eigendeck/issues/62

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePreference, type JupyterServerEntry } from '../lib/preferences';
import { DEFAULT_TEXT_SIZES, type NamedSize } from '../types/presentation';
import { INSERT_ITEMS, INSERT_GROUP_ORDER, type InsertGroup } from '../lib/insertItems';

export type SettingsTab = 'general' | 'security' | 'ui' | 'servers';
type Tab = SettingsTab;
const VALID_TABS: Tab[] = ['general', 'security', 'ui', 'servers'];

// Deep-link support: the Settings window can open on a specific tab. A fresh
// window carries the tab in its URL hash (#ui); an already-open window is told
// via the `eigendeck:settings-tab` window event (settings.tsx bridges the Tauri
// event to it). "Customize Toolbar…" (View menu) uses this to jump to `ui`.
function tabFromHash(): Tab {
  const h = (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '') as Tab;
  return VALID_TABS.includes(h) ? h : 'general';
}

// The settings BODY (tabs + content), chrome-free so it can live either in the
// legacy modal or the standalone Settings window (src/settings.tsx). `header`
// renders a title row (the window uses it; the modal supplies its own with a
// close button).
export function SettingsPanel({ header }: { header?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<Tab>).detail;
      if (VALID_TABS.includes(t)) setTab(t);
    };
    window.addEventListener('eigendeck:settings-tab', onTab);
    return () => window.removeEventListener('eigendeck:settings-tab', onTab);
  }, []);
  return (
    <>
      {header}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb',
        padding: '0 18px',
      }}>
        <TabButton active={tab === 'general'} onClick={() => setTab('general')}>General</TabButton>
        <TabButton active={tab === 'security'} onClick={() => setTab('security')}>Security</TabButton>
        <TabButton active={tab === 'ui'} onClick={() => setTab('ui')}>UI &amp; Toolbar</TabButton>
        <TabButton active={tab === 'servers'} onClick={() => setTab('servers')}>Jupyter servers</TabButton>
      </div>
      <div style={{ padding: '14px 18px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
        {tab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AutoReloadAssetsSetting />
            <DefaultNotebookEditableSetting />
            <TryProjectorModeSetting />
            <DefaultTextSizesSetting />
            <MathPreambleSetting />
          </div>
        )}
        {tab === 'security' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <DemoInternetSetting />
          </div>
        )}
        {tab === 'ui' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ShowHelpTextSetting />
            <CompactToolbarSetting />
            <GridSpacingSetting />
            <ToolbarButtonsSetting />
          </div>
        )}
        {tab === 'servers' && <JupyterServersSetting />}
      </div>
    </>
  );
}

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
          background: '#fff', borderRadius: 8,
          width: 640, maxWidth: '90vw',
          height: 560, maxHeight: '85vh',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}>
        <SettingsPanel header={
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
        } />
      </div>
    </div>,
    document.body,
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      style={{
        padding: '10px 14px',
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 600 : 400,
        color: active ? '#111827' : '#6b7280',
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
        marginBottom: -1,
      }}>
      {children}
    </button>
  );
}

// ---- Jupyter servers tab -------------------------------------------------

function JupyterServersSetting() {
  const [servers, setServers] = usePreference('jupyterServers');

  const addServer = () => setServers([
    ...servers,
    { label: 'New server', baseUrl: 'http://localhost:8888', token: '' },
  ]);
  const updateAt = (i: number, patch: Partial<JupyterServerEntry>) =>
    setServers(servers.map((s, j) => j === i ? { ...s, ...patch } : s));
  const removeAt = (i: number) =>
    setServers(servers.filter((_, j) => j !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...servers];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setServers(next);
  };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Registered servers</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
        Notebook elements pick the FIRST server here that advertises the kernel they need.
        Reorder rows to change which one wins when multiple servers offer the same kernel.
        Tokens stay on this machine; nothing here is written to a deck file.
      </div>

      {servers.length === 0 && (
        <div style={{
          fontSize: 12, color: '#9ca3af', padding: 12,
          border: '1px dashed #d1d5db', borderRadius: 4, textAlign: 'center',
          marginBottom: 12,
        }}>
          No servers registered. Add one to enable live kernel execution.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {servers.map((s, i) => (
          <ServerRow key={i} entry={s}
            isFirst={i === 0}
            onChange={(patch) => updateAt(i, patch)}
            onRemove={() => removeAt(i)}
            onMoveUp={() => moveUp(i)} />
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button onClick={addServer} className="prop-zbtn"
          style={{
            padding: '6px 12px', fontSize: 12,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: 3,
            cursor: 'pointer',
          }}>
          + Add server
        </button>
      </div>
    </div>
  );
}

function ServerRow({ entry, isFirst, onChange, onRemove, onMoveUp }: {
  entry: JupyterServerEntry;
  isFirst: boolean;
  onChange: (patch: Partial<JupyterServerEntry>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
}) {
  // Connection-test state. Result lives in component-local state so
  // the user sees feedback without persisting test-only flags.
  // Successful tests DO persist availableKernels + lastSeenAt to the
  // entry (those are useful for matching + the topbar pill).
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const url = entry.baseUrl.replace(/\/$/, '');
      const q = entry.token ? `?token=${encodeURIComponent(entry.token)}` : '';
      const r = await fetch(`${url}/api/kernelspecs${q}`, {
        headers: entry.token ? { Authorization: `token ${entry.token}` } : {},
      });
      if (!r.ok) {
        setTestResult({ ok: false, msg: `${r.status} ${r.statusText}` });
      } else {
        const data = await r.json();
        const kernels = Object.keys(data.kernelspecs ?? {});
        onChange({ availableKernels: kernels, lastSeenAt: Date.now() });
        setTestResult({ ok: true, msg: kernels.length
          ? `Kernels: ${kernels.join(', ')}`
          : 'Connected, but server reports no kernels' });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 4, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="text"
          value={entry.label}
          placeholder="e.g. Desktop main"
          onChange={(e) => onChange({ label: e.target.value })}
          style={{
            flex: '1 1 auto', padding: '4px 6px', fontSize: 13, fontWeight: 600,
            border: '1px solid transparent', borderRadius: 3, background: 'transparent',
          }}
        />
        <button onClick={onMoveUp} disabled={isFirst} title="Move up"
          style={{
            padding: '2px 8px', fontSize: 11,
            background: isFirst ? '#f3f4f6' : '#fff',
            border: '1px solid #d1d5db', borderRadius: 3,
            color: isFirst ? '#9ca3af' : '#374151',
            cursor: isFirst ? 'default' : 'pointer',
          }}>↑</button>
        <button onClick={onRemove} title="Remove this server"
          style={{
            padding: '2px 8px', fontSize: 11,
            background: '#fff', border: '1px solid #fca5a5', borderRadius: 3,
            color: '#b91c1c', cursor: 'pointer',
          }}>Remove</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>URL</span>
        <input
          type="text"
          value={entry.baseUrl}
          placeholder="http://localhost:8888"
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          style={{ padding: '3px 6px', fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
        <span style={{ fontSize: 11, color: '#6b7280' }}>Token</span>
        <input
          type="password"
          value={entry.token}
          placeholder="(none — server runs token-less)"
          onChange={(e) => onChange({ token: e.target.value })}
          style={{ padding: '3px 6px', fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: '#6b7280' }}>Notes</span>
        <input
          type="text"
          value={entry.notes ?? ''}
          placeholder="optional"
          onChange={(e) => onChange({ notes: e.target.value || undefined })}
          style={{ padding: '3px 6px', fontSize: 12 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <button onClick={test} disabled={testing}
          style={{
            padding: '4px 10px', fontSize: 11,
            background: '#2563eb', color: '#fff',
            border: 'none', borderRadius: 3, cursor: testing ? 'wait' : 'pointer',
          }}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {testResult && (
          <span style={{ fontSize: 11, color: testResult.ok ? '#065f46' : '#b91c1c' }}>
            {testResult.ok ? '✓' : '✕'} {testResult.msg}
          </span>
        )}
        {!testResult && entry.availableKernels && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            kernels: {entry.availableKernels.length ? entry.availableKernels.join(', ') : '(none reported)'}
            {entry.lastSeenAt && ` · last seen ${timeAgo(entry.lastSeenAt)}`}
          </span>
        )}
      </div>
    </div>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// ---- General tab settings (unchanged) ------------------------------------

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
                value={current ?? fallback}
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

function DefaultNotebookEditableSetting() {
  const [value, setValue] = usePreference('defaultNotebookEditable');
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Notebooks editable by default</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            New notebook elements start with editable code cells. Off by
            default (the read-only "canned demo" case). Each notebook
            can override this in its inspector. While a notebook is
            editable its .ipynb is no longer auto-watched for on-disk
            changes (so your edits aren't clobbered) — pull external
            changes yourself with the inspector's "Reload from disk".
          </div>
        </div>
      </label>
    </div>
  );
}

function DemoInternetSetting() {
  const [value, setValue] = usePreference('demoInternetAccess');
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.5 }}>
        Demos are little interactive web widgets on your slides — charts, simulations,
        graphs. They run in a safe sandbox and <strong>can’t open, read, or change your
        files.</strong>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Let demos use the internet</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            Some demos fetch live data (weather, stock prices, maps). But internet access
            can also let a demo phone home — for example, tracking when and where you open
            a deck. Turn this off to keep every demo offline. This is the master switch —
            when it’s off, no presentation’s demos can go online, even if a deck asks to.
          </div>
        </div>
      </label>
    </div>
  );
}

const TOOLBAR_GROUP_LABELS: Record<InsertGroup, string> = {
  text: 'Text',
  objects: 'Objects',
  embeds: 'Embeds',
};

function ToolbarButtonsSetting() {
  const [hidden, setHidden] = usePreference('hiddenToolbarItems');
  const setShown = (id: string, show: boolean) => {
    if (show) setHidden(hidden.filter((h) => h !== id));
    else if (!hidden.includes(id)) setHidden([...hidden, id]);
  };
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Toolbar buttons</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
        Choose which "+ Insert" buttons appear on the editor toolbar. Unchecked
        items are still available from the <strong>Insert</strong> menu — this
        only declutters the toolbar.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {INSERT_GROUP_ORDER.map((group) => (
          <div key={group}>
            <div style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
              color: '#9ca3af', marginBottom: 4,
            }}>{TOOLBAR_GROUP_LABELS[group]}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px' }}>
              {INSERT_ITEMS.filter((it) => it.group === group).map((it) => (
                <label key={it.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', minWidth: 100 }}
                  title={it.tooltip}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(it.id)}
                    onChange={(e) => setShown(it.id, e.target.checked)} />
                  {it.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GridSpacingSetting() {
  const [value, setValue] = usePreference('gridSpacing');
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Alignment grid spacing (px)</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
        Spacing of the editor alignment grid, in slide pixels (the slide is 1920×1080).
        Turn the grid on per-session from <strong>View → Show Grid Points</strong> and
        <strong> View → Snap to Grid</strong>; hold ⌘ while dragging to bypass snapping.
        Editor-only — never shown when presenting or exporting.
      </div>
      {/* Spinner + presets on one line. Presets: divisors of gcd(1920,1080)=120,
          so the grid tiles the slide evenly. Finer values (<30) also draw a
          thicker "+" every 16 cells. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <input
          type="number"
          min={4} max={480} step={1}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v >= 4 && v <= 480) setValue(v);
          }}
          style={{ width: 64, padding: '3px 6px', fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>px</span>
        {[12, 15, 20, 24, 30, 40, 60].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setValue(p)}
            title={`${p} px — ${1920 / p}×${1080 / p} cells`}
            style={{
              padding: '2px 8px', fontSize: 11, cursor: 'pointer',
              borderRadius: 4,
              border: value === p ? '1px solid #2563eb' : '1px solid #d1d5db',
              background: value === p ? '#eff6ff' : '#fff',
              color: value === p ? '#1d4ed8' : '#374151',
              fontWeight: value === p ? 600 : 400,
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function ShowHelpTextSetting() {
  const [value, setValue] = usePreference('showHelpText');
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Show explanatory help text</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            The grey paragraphs under inspector controls that explain what each
            option does. On by default; turn off for a denser inspector once
            you know your way around.
          </div>
        </div>
      </label>
    </div>
  );
}

function CompactToolbarSetting() {
  const [value, setValue] = usePreference('compactToolbar');
  // macOS native-toolbar builds only — the setting drives the NSToolbar. Hide it
  // everywhere else (there's nothing for it to affect).
  const [native, setNative] = useState(false);
  useEffect(() => {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<boolean>('native_toolbar_active'))
      .then((v) => setNative(!!v))
      .catch(() => {});
  }, []);
  if (!native) return null;
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Compact toolbar</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            Hide the toolbar button labels and shrink the icons to reclaim vertical
            space. Hover a button to see its name as a tooltip. Applies immediately —
            no restart needed. (macOS only.)
          </div>
        </div>
      </label>
    </div>
  );
}

function TryProjectorModeSetting() {
  const [value, setValue] = usePreference('tryProjectorMode');
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Present will try projector mode</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            When you start Present Mode (F5) and a second display is connected,
            open the live slide there fullscreen with the speaker view on this
            screen. Turn off to always present in a single window on the current
            screen. (The “Screen Share Presentation” and “Present in This Window”
            menu items are explicit and ignore this.)
          </div>
        </div>
      </label>
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
