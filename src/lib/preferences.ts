// Global (app-level, cross-project) user preferences.
//
// Backed by browser localStorage for v1 — simple, persistent across
// sessions for the Tauri webview, no Rust round-trip on read.
// Trade-off: not visible/editable outside the app. If we ever want
// shell access ("eigendeck-cli set autoReloadAssets false") move to
// a JSON file in app_data_dir behind two Tauri commands; the public
// API (getPreference / setPreference / usePreference) stays the same.

import { useCallback, useEffect, useState } from 'react';

/**
 * The canonical pref schema. Every pref the app reads goes here so
 * defaults are centralized and TypeScript catches typos.
 */
export interface PrefSchema {
  /** Master switch for the asset file watcher. When false, NO asset is
   *  auto-reloaded on disk change unless the asset itself has
   *  auto_reload='on' (explicit per-asset opt-in overrides the global
   *  off). When true, assets are auto-reloaded UNLESS auto_reload='off'.
   *  See effectiveAutoReload() for the resolution. */
  autoReloadAssets: boolean;
  /** Default LaTeX preamble used as a template for new presentations and
   *  as the source for the per-presentation preamble's "Insert global" /
   *  "Replace with global" buttons. Render path only uses the
   *  per-presentation preamble; this is editing-only. */
  mathPreamble: string;
  /** Default deck-level type scale overrides for NEW presentations.
   *  When a new deck is created, its PresentationConfig.textSizes is
   *  seeded from this. Any keys absent here fall back to
   *  DEFAULT_TEXT_SIZES at render time. Empty object = use built-in
   *  defaults across the board. Existing decks are NOT affected — they
   *  keep whatever textSizes they were saved with. */
  textSizes: Partial<Record<'footnote' | 'note' | 'body' | 'title' | 'hype', number>>;
  /** Per-machine registry of Jupyter kernel servers. Notebook elements
   *  store ONLY the kernel name they need (`python3`, `julia-1.10`,
   *  ...) — the resolver finds the first registry server whose
   *  `availableKernels` contains the requested name and dials its
   *  baseUrl with its token. Tokens stay on this machine; decks never
   *  carry them. */
  jupyterServers: JupyterServerEntry[];
  /** Default editability for notebook elements. When a notebook's
   *  own `editable` field is unset, this is the fallback. Default
   *  false — the common "canned demo" case is read-only. A presenter
   *  who lives in live-typing mode can flip this so new notebooks
   *  start editable. (Per-element override still wins.) Turning a
   *  notebook editable disables file-watching for its asset — see
   *  NotebookElement.editable. */
  defaultNotebookEditable: boolean;
  /** Show the explanatory help text under inspector controls (the grey
   *  paragraphs that explain what a toggle does). On by default; experienced
   *  users can turn it off for a denser inspector. */
  showHelpText: boolean;
  /** Insert-action ids hidden from the editor toolbar (see
   *  src/lib/insertItems.ts for the id list). A *hidden* list, not a
   *  visible one, so element types added in future releases show up on
   *  the toolbar by default. The native "Insert" menu ignores this — it
   *  always lists every action. Default [] (everything on the toolbar). */
  hiddenToolbarItems: string[];
}

export interface JupyterServerEntry {
  /** Display name in Settings + the topbar status pill. */
  label: string;
  /** REST + WebSocket base URL, e.g. 'http://localhost:8888'. */
  baseUrl: string;
  /** Auth token. Empty string when the server runs token-less
   *  (--ServerApp.token=''). */
  token: string;
  /** Kernel ids discovered from /api/kernelspecs. Populated by the
   *  Settings UI's "Test connection" action and by the auto-discovery
   *  poll on app start. Empty = unknown (server never reached). */
  availableKernels?: string[];
  /** Unix-ms timestamp of the last successful contact, for the
   *  status pill staleness check. Absent = never. */
  lastSeenAt?: number;
  /** Optional free-form note shown in Settings. */
  notes?: string;
}

const DEFAULTS: PrefSchema = {
  autoReloadAssets: true,
  mathPreamble: '',
  textSizes: {},
  jupyterServers: [],
  defaultNotebookEditable: false,
  showHelpText: true,
  hiddenToolbarItems: [],
};

const KEY_PREFIX = 'eigendeck:pref:';
const CHANGE_EVENT = 'eigendeck:pref-changed';

export function getPreference<K extends keyof PrefSchema>(key: K): PrefSchema[K] {
  try {
    const v = localStorage.getItem(KEY_PREFIX + key);
    if (v === null) return DEFAULTS[key];
    return JSON.parse(v) as PrefSchema[K];
  } catch {
    return DEFAULTS[key];
  }
}

export function setPreference<K extends keyof PrefSchema>(key: K, value: PrefSchema[K]): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
  } catch (e) {
    console.warn(`[prefs] setPreference(${key}) failed:`, e);
  }
}

/**
 * Reactive read of a preference. Re-renders the component when the
 * preference changes (via setPreference from anywhere in the app).
 * Returns [value, setter] like useState.
 */
export function usePreference<K extends keyof PrefSchema>(
  key: K,
): [PrefSchema[K], (v: PrefSchema[K]) => void] {
  const [value, setValue] = useState<PrefSchema[K]>(() => getPreference(key));
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === key) setValue(getPreference(key));
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [key]);
  const setter = useCallback((v: PrefSchema[K]) => setPreference(key, v), [key]);
  return [value, setter];
}

/**
 * Resolve the effective auto_reload state for an asset.
 *
 * Cascade is **downward-only**: any layer can refuse, no layer overrides a
 * refusal above it. Pass null/undefined for layers without an explicit
 * opt-out. For "would a NEW asset in this presentation auto-reload by
 * default", pass null for perAsset.
 *
 *   global must be true                     (else: off everywhere)
 *   per-presentation must not be 'off'      (else: off in this deck)
 *   per-asset must not be 'off'             (else: off for this asset)
 *
 * Per-asset 'on' is NOT a thing — an asset can opt out but can't opt in
 * beyond what the presentation/global allow. Legacy 'on' values in the
 * database (from earlier 3-state UI) are treated as if NULL.
 */
export function effectiveAutoReload(
  perAsset: string | null | undefined,
  perPresentation: string | null | undefined,
  globalDefault: boolean,
): boolean {
  return globalDefault
    && perPresentation !== 'off'
    && perAsset !== 'off';
}
