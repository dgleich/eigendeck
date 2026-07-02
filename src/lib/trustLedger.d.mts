// Type declarations for trustLedger.mjs (see the .mjs/.d.mts convention used across
// src/lib so .ts callers get types while the logic stays framework-free JS).

export const TRUST_TTL_DAYS: number;
export const TRUST_TTL_MS: number;

export interface DeckEntry {
  trusted: boolean;
  lastOpenMs: number;
  /** assetId → approved RESOLVED path */
  approvals: Record<string, string>;
}

export type DeckStatus = 'untrusted-new' | 'untrusted-ttl' | 'trusted';

export interface DeckStateResult {
  status: DeckStatus;
  /** approved RESOLVED paths (deduped) */
  approvals: string[];
  lapsed: boolean;
}

export class TrustLedger {
  constructor(entries?: Record<string, DeckEntry>);
  deckState(token: string, now: number): DeckStateResult;
  isTrusted(token: string, now: number): boolean;
  isApproved(token: string, resolvedPath: string, now: number): boolean;
  createTrusted(token: string, now: number): this;
  /** `approvals`: assetId → resolved path */
  trust(token: string, approvals: Record<string, string>, now: number): this;
  /** Approve/re-point one asset's resolved target (replaces the asset's prior entry). */
  approve(token: string, assetId: string, resolvedPath: string, now: number): boolean;
  /** Drop approvals for assets not in `keepAssetIds`; returns the count removed. */
  reconcile(token: string, keepAssetIds: string[], now: number): number;
  open(token: string, now: number): DeckStatus;
  reconfirm(token: string, now: number): boolean;
  revoke(token: string): boolean;
  serialize(): Record<string, DeckEntry>;
  static deserialize(obj: unknown): TrustLedger;
}
