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
}

const DEFAULTS: PrefSchema = {
  autoReloadAssets: true,
  mathPreamble: '',
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
 * Cascade (most-specific wins):
 *   per-asset 'on'      -> ALWAYS reload (explicit opt-in, beats every layer)
 *   per-asset 'off'     -> NEVER reload  (Restore sets this; user opt-out)
 *   per-presentation 'on'  -> ALWAYS reload for assets without their own override
 *   per-presentation 'off' -> NEVER reload  for assets without their own override
 *   else                -> follow the global pref
 *
 * Pass null/undefined for any layer not set. For "would a NEW asset in this
 * presentation auto-reload by default", pass null for perAsset.
 */
export function effectiveAutoReload(
  perAsset: string | null | undefined,
  perPresentation: string | null | undefined,
  globalDefault: boolean,
): boolean {
  if (perAsset === 'on') return true;
  if (perAsset === 'off') return false;
  if (perPresentation === 'on') return true;
  if (perPresentation === 'off') return false;
  return globalDefault;
}
