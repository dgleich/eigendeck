// Migration: extract legacy `kernel.baseUrl` + `kernel.token` from
// notebook elements in an old deck (pre-server-registry schema) and
// fold them into the per-machine PrefSchema.jupyterServers registry.
//
// Runs on deck load. Mutates the presentation in place (strips the
// legacy fields) so the next save no longer carries them. Idempotent:
// running on a clean deck does nothing.
//
// Heuristic for de-duplication: an existing registry entry "matches"
// a legacy element when its baseUrl is byte-identical to the
// element's. If the tokens differ, we keep the existing entry as-is
// (the user's saved registry wins; we're not in the business of
// overwriting their token mid-load). If no match exists, we add a
// new entry labeled by the URL host:port.

import { Presentation } from '../types/presentation';
import {
  getPreference, setPreference, type JupyterServerEntry,
} from './preferences';

interface LegacyExternal {
  kind: 'external';
  baseUrl?: string;
  kernelName?: string;
  token?: string;
}

interface LegacyNotebookKernel {
  kind: 'external' | 'lite';
  baseUrl?: string;
  kernelName?: string;
  token?: string;
}

/** Returns true if anything was changed. Caller should `setPresentation`
 *  with the (mutated) input either way; only the return value is
 *  needed for logging. */
export function migrateLegacyNotebookTokens(pres: Presentation): boolean {
  let mutated = false;
  const registry = [...getPreference('jupyterServers')];
  let registryChanged = false;

  // Helper: strip legacy fields from a kernel object in place.
  const cleanKernel = (k: LegacyNotebookKernel): void => {
    const obj = k as unknown as Record<string, unknown>;
    if ('baseUrl' in obj) { delete obj.baseUrl; mutated = true; }
    if ('token' in obj) { delete obj.token; mutated = true; }
  };

  // Harvest from deck-level config.notebookKernel + every element.
  const harvest = (k: LegacyExternal | undefined) => {
    if (!k || k.kind !== 'external') return;
    const baseUrl = k.baseUrl?.trim();
    if (!baseUrl) return;
    const existing = registry.find((s) => s.baseUrl === baseUrl);
    if (existing) {
      // If existing entry has no token but the deck did, fill it in;
      // otherwise the registry's token wins.
      if (!existing.token && k.token) {
        existing.token = k.token;
        registryChanged = true;
      }
    } else {
      const newEntry: JupyterServerEntry = {
        label: `Migrated ${labelFromUrl(baseUrl)}`,
        baseUrl,
        token: k.token ?? '',
      };
      registry.push(newEntry);
      registryChanged = true;
    }
  };

  // Deck-level default kernel.
  const cfgKernel = (pres.config as { notebookKernel?: LegacyNotebookKernel }).notebookKernel;
  if (cfgKernel && cfgKernel.kind === 'external') {
    harvest(cfgKernel as LegacyExternal);
    cleanKernel(cfgKernel);
  }

  // Per-element overrides.
  for (const slide of pres.slides) {
    for (const el of slide.elements) {
      if (el.type !== 'notebook') continue;
      const k = (el as { kernel?: LegacyNotebookKernel }).kernel;
      if (!k) continue;
      if (k.kind === 'external') {
        harvest(k as LegacyExternal);
        cleanKernel(k);
      }
    }
  }

  if (registryChanged) {
    setPreference('jupyterServers', registry);
    mutated = true;
  }

  return mutated;
}

function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return url;
  }
}
