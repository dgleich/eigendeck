// Builds the per-deck "external files" report for the Security panel.
//
// One row per linked (external_path) asset: what the deck references, the REAL
// resolved target (realpath), where it's used, and its asset-security state
// (approved / eligible / forbidden / missing). The panel renders resolved targets
// in plain sight (transparency) and gates approval on state. See docs/ASSETS-SECURITY.md.

import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { resolveAndGate } from './assetGate';
import { resolvePosixPath, dirname } from './watcherRegistry';
import { isTrusted, isPathApproved } from './trustStore';
import { computeAssetUsage } from './assetUsage';

export type RowState = 'approved' | 'eligible' | 'forbidden' | 'missing';

export interface ExternalPathRow {
  assetId: string;
  /** external_path as stored in the deck (what the author wrote). */
  referencePath: string;
  /** Fully resolved real target, or null if it couldn't be resolved. */
  resolvedPath: string | null;
  state: RowState;
  /** Short reason for forbidden/missing (destination-forward for the UI). */
  reason: string | null;
  /** "Used on 2 slides" style label. */
  usage: string;
}

export interface DeckSecurityReport {
  deckHasToken: boolean;
  trusted: boolean;
  rows: ExternalPathRow[];
}

interface LinkedRow { asset_id: string; external_path: string; }

function usageLabel(assetId: string): string {
  const pres = usePresentationStore.getState().presentation;
  const u = computeAssetUsage(pres, assetId);
  if (u.elementCount === 0) return 'unused';
  if (u.slideCount === 1) return u.elementCount === 1 ? 'used on 1 slide' : `used ${u.elementCount}× on 1 slide`;
  return `used on ${u.slideCount} slides`;
}

/** Build the report for the currently-open deck. Never throws. */
export async function buildDeckSecurityReport(): Promise<DeckSecurityReport> {
  const store = usePresentationStore.getState();
  const token = store.presentation.config.deckToken;
  const trusted = token ? await isTrusted(token) : false;
  const projectDir = store.projectPath ? dirname(store.projectPath) : '';

  let linked: LinkedRow[] = [];
  try { linked = await invoke<LinkedRow[]>('db_list_linked_assets'); } catch { linked = []; }

  const rows: ExternalPathRow[] = [];
  for (const a of linked) {
    if (!a.external_path) continue;
    const gate = await resolveAndGate(resolvePosixPath(projectDir, a.external_path));
    let state: RowState;
    let reason: string | null = null;
    if (!gate.ok) {
      if (gate.reason === 'unreadable') { state = 'missing'; reason = 'source not found on disk'; }
      else { state = 'forbidden'; reason = gate.reason; }
    } else {
      const approved = token ? await isPathApproved(token, gate.canonicalPath!) : false;
      state = approved ? 'approved' : 'eligible';
    }
    rows.push({
      assetId: a.asset_id,
      referencePath: a.external_path,
      resolvedPath: gate.canonicalPath ?? null,
      state,
      reason,
      usage: usageLabel(a.asset_id),
    });
  }
  return { deckHasToken: !!token, trusted, rows };
}

/** Ensure the current deck has a trusted identity, minting a token for a legacy
 *  deck. Returns the token. LEDGER-ONLY (no scan) — the caller notifies the main
 *  window, which owns the watcher, to re-scan. */
async function ensureTrusted(): Promise<string> {
  const store = usePresentationStore.getState();
  let token = store.presentation.config.deckToken;
  if (!token) { token = crypto.randomUUID(); store.updateConfig({ deckToken: token }); }
  const { createTrustedDeck, isTrusted: chk } = await import('./trustStore');
  if (!(await chk(token))) await createTrustedDeck(token);
  return token;
}

/** Approve one eligible asset (by its id + reference path). Trusts the deck first if
 *  needed. LEDGER-ONLY. Returns the fresh report. */
export async function approveOne(assetId: string, referencePath: string): Promise<DeckSecurityReport> {
  const token = await ensureTrusted();
  const store = usePresentationStore.getState();
  const projectDir = store.projectPath ? dirname(store.projectPath) : '';
  const gate = await resolveAndGate(resolvePosixPath(projectDir, referencePath));
  if (gate.ok && gate.canonicalPath) {
    const { approvePath } = await import('./trustStore');
    await approvePath(token, assetId, gate.canonicalPath);
  }
  return buildDeckSecurityReport();
}

/** Trust the deck + approve ALL its current resolvable paths. LEDGER-ONLY.
 *  Returns the fresh report. */
export async function trustAllCurrent(): Promise<DeckSecurityReport> {
  const token = await ensureTrusted();
  const store = usePresentationStore.getState();
  const projectDir = store.projectPath ? dirname(store.projectPath) : '';
  const { approvePath } = await import('./trustStore');
  let linked: LinkedRow[] = [];
  try { linked = await invoke<LinkedRow[]>('db_list_linked_assets'); } catch { linked = []; }
  for (const a of linked) {
    if (!a.external_path || !a.asset_id) continue;
    const gate = await resolveAndGate(resolvePosixPath(projectDir, a.external_path));
    if (gate.ok && gate.canonicalPath) await approvePath(token, a.asset_id, gate.canonicalPath);
  }
  return buildDeckSecurityReport();
}
