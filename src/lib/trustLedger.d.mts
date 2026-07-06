// Type declarations for trustLedger.mjs (see the .mjs/.d.mts convention used across
// src/lib so .ts callers get types while the logic stays framework-free JS).

export const TRUST_TTL_DAYS: number;
export const TRUST_TTL_MS: number;

/** How a deck became trusted. */
export type TrustReason = 'file-new' | 'trusted';

export interface ApprovalEntry {
  /** approved RESOLVED (realpath) target */
  resolved: string;
  /** epoch ms the approval was granted */
  at: number;
  /** how it was granted */
  reason: string;
}

export interface DeckEntry {
  trusted: boolean;
  /** epoch ms first trusted */
  trustedAt: number;
  /** how it became trusted */
  trustReason: string;
  lastOpenMs: number;
  /** assetId → approval provenance */
  approvals: Record<string, ApprovalEntry>;
  /** resolved eligible paths already surfaced by the on-open review nudge */
  seenEligible: string[];
  /** per-deck: block this deck's demos from the internet (default false) */
  blockInternet?: boolean;
  /** per-demo: assetIds denied internet individually (default []) */
  blockedDemos?: string[];
}

export type DeckStatus = 'untrusted-new' | 'untrusted-ttl' | 'trusted';

export interface DeckStateResult {
  status: DeckStatus;
  /** approved RESOLVED paths (deduped) */
  approvals: string[];
  lapsed: boolean;
  /** epoch ms first trusted, or null if never trusted */
  trustedAt: number | null;
  /** how it became trusted, or null */
  trustReason: string | null;
}

export class TrustLedger {
  constructor(entries?: Record<string, DeckEntry>);
  deckState(token: string, now: number): DeckStateResult;
  /** Provenance for one approved resolved path, or null. */
  approvalDetail(token: string, resolvedPath: string): { at: number; reason: string } | null;
  isTrusted(token: string, now: number): boolean;
  isApproved(token: string, resolvedPath: string, now: number): boolean;
  /** Is this deck's demo internet access blocked (per-deck local choice)? */
  isInternetBlocked(token: string): boolean;
  /** Set the per-deck internet block; creates a minimal entry if none exists. */
  setInternetBlocked(token: string, blocked: boolean, now?: number): this;
  /** Is THIS demo (by assetId) individually blocked from the internet? */
  isDemoBlocked(token: string, assetId: string): boolean;
  /** Allow/deny one demo's internet by assetId; creates a minimal entry if none. */
  setDemoBlocked(token: string, assetId: string, blocked: boolean, now?: number): this;
  createTrusted(token: string, now: number, reason?: TrustReason): this;
  /** `approvals`: assetId → resolved path (each stamped now + reason 'trusted') */
  trust(token: string, approvals: Record<string, string>, now: number): this;
  /** Approve/re-point one asset's resolved target (replaces the asset's prior entry). */
  approve(token: string, assetId: string, resolvedPath: string, reason: string, now: number): boolean;
  /** Revoke one asset's approval without touching trust or the others. */
  unapprove(token: string, assetId: string, now: number): boolean;
  /** Drop approvals for assets not in `keepAssetIds`; returns the count removed. */
  reconcile(token: string, keepAssetIds: string[], now: number): number;
  /** Record surfaced eligible paths + report how many are new since last time. */
  noteEligible(token: string, resolvedPaths: string[], now: number): { total: number; newCount: number };
  open(token: string, now: number): DeckStatus;
  reconfirm(token: string, now: number): boolean;
  revoke(token: string): boolean;
  serialize(): Record<string, DeckEntry>;
  static deserialize(obj: unknown): TrustLedger;
}
