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
import { isTrusted, isPathApproved, deckState, approvalDetail } from './trustStore';
import { getPreference } from './preferences';
import { computeAssetUsage } from './assetUsage';
import type { DeckStatus } from './trustLedger.d.mts';

export type RowState = 'approved' | 'eligible' | 'forbidden' | 'missing';

export interface ExternalPathRow {
  assetId: string;
  /** external_path as stored in the deck (what the author wrote). */
  referencePath: string;
  /** Fully resolved real target, or null if it couldn't be resolved. */
  resolvedPath: string | null;
  /** Directory of the resolved target (for "approve all in this folder"), or null. */
  resolvedDir: string | null;
  state: RowState;
  /** Short reason for forbidden/missing (destination-forward for the UI). */
  reason: string | null;
  /** "Used on 2 slides" style label. */
  usage: string;
  /** Approval provenance (approved rows only): when + how it was approved. */
  approvedAt: number | null;
  approvedHow: string | null;
}

export interface DeckSecurityReport {
  trusted: boolean;
  /** Ledger trust status: untrusted-new (received, never trusted) / untrusted-ttl
   *  (trust lapsed) / trusted. */
  status: DeckStatus;
  /** When the deck was first trusted (epoch ms), or null. */
  trustedAt: number | null;
  /** How it became trusted ('file-new' = you created it, 'trusted' = you trusted a
   *  received deck), or null. */
  trustReason: string | null;
  /** Watch settings: global (Settings) and this deck's per-presentation override. */
  watch: { global: boolean; deck: 'on' | 'off' | null };
  /** The presentation's directory (for the "outside the deck folder" tint). */
  projectDir: string;
  counts: { total: number; approved: number; eligible: number; blocked: number; missing: number };
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
    let approvedAt: number | null = null;
    let approvedHow: string | null = null;
    if (!gate.ok) {
      if (gate.reason === 'unreadable') { state = 'missing'; reason = 'source not found on disk'; }
      else { state = 'forbidden'; reason = gate.reason; }
    } else {
      const approved = token ? await isPathApproved(token, gate.canonicalPath!) : false;
      state = approved ? 'approved' : 'eligible';
      if (approved && token) {
        const detail = await approvalDetail(token, gate.canonicalPath!);
        approvedAt = detail?.at ?? null;
        approvedHow = detail?.reason ?? null;
      }
    }
    rows.push({
      assetId: a.asset_id,
      referencePath: a.external_path,
      resolvedPath: gate.canonicalPath ?? null,
      resolvedDir: gate.canonicalPath ? dirname(gate.canonicalPath) : null,
      state,
      reason,
      usage: usageLabel(a.asset_id),
      approvedAt,
      approvedHow,
    });
  }

  const ds = token ? await deckState(token) : null;
  const counts = {
    total: rows.length,
    approved: rows.filter((r) => r.state === 'approved').length,
    eligible: rows.filter((r) => r.state === 'eligible').length,
    blocked: rows.filter((r) => r.state === 'forbidden').length,
    missing: rows.filter((r) => r.state === 'missing').length,
  };
  return {
    trusted,
    status: ds?.status ?? 'untrusted-new',
    trustedAt: ds?.trustedAt ?? null,
    trustReason: ds?.trustReason ?? null,
    watch: { global: getPreference('autoReloadAssets'), deck: store.presentation.config.autoReloadAssets ?? null },
    projectDir,
    counts,
    rows,
  };
}

/** Ensure the current deck has a trusted identity, minting a token for a legacy
 *  deck. Returns the token. LEDGER-ONLY (no scan) — the caller notifies the main
 *  window, which owns the watcher, to re-scan. */
async function ensureTrusted(): Promise<string> {
  const store = usePresentationStore.getState();
  let token = store.presentation.config.deckToken;
  if (!token) { token = crypto.randomUUID(); store.updateConfig({ deckToken: token }); }
  const { createTrustedDeck, isTrusted: chk } = await import('./trustStore');
  if (!(await chk(token))) await createTrustedDeck(token, 'trusted');
  return token;
}

/** Explicitly TRUST the current deck — the deck-level decision that unlocks watching
 *  and approval. Approves NO files by itself (paths stay Eligible until approved); this
 *  is a SEPARATE step from approving files, never combined. Mints a token for a legacy
 *  deck. Returns the fresh report. See docs/ASSETS-SECURITY.md ("Trust store"). */
export async function trustThisDeck(): Promise<DeckSecurityReport> {
  await ensureTrusted();
  return buildDeckSecurityReport();
}

/** Re-confirm a deck whose trust lapsed (TTL): restores its retained approvals in one
 *  act. LEDGER-ONLY (shared appData persists it) — caller notifies the main window to
 *  re-scan. Returns the fresh report. */
export async function reconfirmThisDeck(): Promise<DeckSecurityReport> {
  const token = usePresentationStore.getState().presentation.config.deckToken;
  if (token) { const { reconfirmDeck } = await import('./trustStore'); await reconfirmDeck(token); }
  return buildDeckSecurityReport();
}

/** Approve one eligible asset. REQUIRES the deck to be trusted already — trust is a
 *  separate, explicit act (trustThisDeck); this never trusts on your behalf. A no-op if
 *  the deck isn't trusted (approvePath guards it) or the target no longer resolves. */
export async function approveOne(assetId: string, referencePath: string): Promise<DeckSecurityReport> {
  const store = usePresentationStore.getState();
  const token = store.presentation.config.deckToken;
  if (token) {
    const projectDir = store.projectPath ? dirname(store.projectPath) : '';
    const gate = await resolveAndGate(resolvePosixPath(projectDir, referencePath));
    if (gate.ok && gate.canonicalPath) {
      const { approvePath } = await import('./trustStore'); // approvePath no-ops if untrusted
      await approvePath(token, assetId, gate.canonicalPath, 'approve');
    }
  }
  return buildDeckSecurityReport();
}

/** Revoke ONE approved asset's approval (per-file). Leaves deck trust and every other
 *  approval intact. Returns the fresh report. */
export async function revokeApproval(assetId: string): Promise<DeckSecurityReport> {
  const token = usePresentationStore.getState().presentation.config.deckToken;
  if (token) { const { unapproveAsset } = await import('./trustStore'); await unapproveAsset(token, assetId); }
  return buildDeckSecurityReport();
}

/** Approve ALL currently-eligible files whose resolved target sits in `resolvedDir`
 *  — the "approve everything in this folder" bulk action (still a per-path decision,
 *  just batched by directory). REQUIRES a trusted deck; no-op otherwise. This is NOT a
 *  trust action — the deck must already be trusted (trustThisDeck), keeping deck-trust
 *  and file-approval two distinct steps. Returns the fresh report. */
export async function approveDirectory(resolvedDir: string): Promise<DeckSecurityReport> {
  const store = usePresentationStore.getState();
  const token = store.presentation.config.deckToken;
  if (token) {
    const { approvePath } = await import('./trustStore');
    const report = await buildDeckSecurityReport();
    for (const r of report.rows) {
      if (r.state === 'eligible' && r.resolvedPath && r.resolvedDir === resolvedDir) {
        await approvePath(token, r.assetId, r.resolvedPath, 'approve-folder');
      }
    }
  }
  return buildDeckSecurityReport();
}
