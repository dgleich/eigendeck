// The trust ledger — app-side record of which decks are trusted and which resolved
// paths are approved for watching. See docs/ASSETS-SECURITY.md ("Trust store" +
// "State model"). This module is PURE state + logic: the current time is injected
// (`now` ms epoch) and persistence is external, so it is fully unit-testable and
// has no clock/DOM/fs dependency. A thin Tauri-fs layer (elsewhere) loads/saves it.
//
// Keyed by `deck-token` (a random id stamped into the deck at File → New; a received
// deck's token isn't in the ledger). Per deck we keep: whether it was ever trusted,
// the last-open time (for the TTL), and the set of approved *resolved* paths.
//
// Three nested levels live here only for the DECK/TRUST axis: whether a deck is
// trusted and whether a path is approved. Watching on/off and the asset-type gate
// live elsewhere (preferences + assetTypes.mjs).

export const TRUST_TTL_DAYS = 30;
export const TRUST_TTL_MS = TRUST_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} DeckEntry
 * @property {boolean} trusted       ever trusted (File → New, or explicitly trusted)
 * @property {number}  lastOpenMs    epoch ms of last open — the TTL is measured from here
 * @property {string[]} approvals    approved RESOLVED paths (see the assetTypeGate contract)
 */

/** Deck-level status derived from an entry + the current time. */
// 'untrusted-new' — never trusted (or revoked): no retained approvals.
// 'untrusted-ttl' — was trusted, lapsed by the TTL: approvals retained but inactive.
// 'trusted'       — trusted and within the TTL: approvals active.

export class TrustLedger {
  /** @param {Record<string, DeckEntry>} [entries] */
  constructor(entries = {}) {
    /** @type {Map<string, DeckEntry>} */
    this.decks = new Map(Object.entries(entries).map(([k, v]) => [k, normalizeEntry(v)]));
  }

  /** Deck status right now: { status, approvals, lapsed }. approvals are RETURNED
   *  even when lapsed (retained-but-inactive), so callers can offer "restore". */
  deckState(token, now) {
    const e = this.decks.get(token);
    if (!e || !e.trusted) return { status: 'untrusted-new', approvals: [], lapsed: false };
    const lapsed = now - e.lastOpenMs > TRUST_TTL_MS;
    return lapsed
      ? { status: 'untrusted-ttl', approvals: [...e.approvals], lapsed: true }
      : { status: 'trusted', approvals: [...e.approvals], lapsed: false };
  }

  /** Is this deck effectively trusted right now (trusted AND not TTL-lapsed)? */
  isTrusted(token, now) {
    return this.deckState(token, now).status === 'trusted';
  }

  /** May this resolved path be read/watched now? Requires effective trust AND an
   *  ACTIVE approval. A lapsed deck's retained approvals do NOT authorize reads. */
  isApproved(token, resolvedPath, now) {
    const s = this.deckState(token, now);
    return s.status === 'trusted' && s.approvals.includes(resolvedPath);
  }

  // --- transitions (mutating; callers persist afterward) --------------------

  /** File → New: stamp a fresh trusted deck with no approvals yet. */
  createTrusted(token, now) {
    this.decks.set(token, { trusted: true, lastOpenMs: now, approvals: [] });
    return this;
  }

  /** Explicitly trust a (received) deck, approving the reviewed resolved paths.
   *  Also used by File → New (paths = []). Replaces any prior approval set. */
  trust(token, resolvedPaths, now) {
    this.decks.set(token, { trusted: true, lastOpenMs: now, approvals: uniq(resolvedPaths) });
    return this;
  }

  /** Approve one more resolved path on an already-trusted deck. No-op (returns
   *  false) if the deck isn't effectively trusted right now. */
  approve(token, resolvedPath, now) {
    if (!this.isTrusted(token, now)) return false;
    const e = this.decks.get(token);
    if (!e.approvals.includes(resolvedPath)) e.approvals.push(resolvedPath);
    return true;
  }

  /** Opening a trusted (non-lapsed) deck refreshes the TTL clock. A lapsed deck is
   *  NOT refreshed here (it stays untrusted-ttl until an explicit re-confirm), and
   *  an untrusted deck is a no-op. Returns the resulting status. */
  open(token, now) {
    const s = this.deckState(token, now);
    if (s.status === 'trusted') this.decks.get(token).lastOpenMs = now;
    return s.status;
  }

  /** Re-confirm after a TTL lapse: restore the retained approvals by refreshing the
   *  clock. The caller has shown the user the retained paths; excluding any that no
   *  longer pass the gate is the caller's job (it re-checks at read anyway). */
  reconfirm(token, now) {
    const e = this.decks.get(token);
    if (!e) return false;
    e.trusted = true;
    e.lastOpenMs = now;
    return true;
  }

  /** Explicit revoke: drop the deck entirely — untrust AND remove approvals. Next
   *  open is untrusted-new (re-trust = approve from scratch). */
  revoke(token) {
    return this.decks.delete(token);
  }

  // --- persistence ----------------------------------------------------------

  /** Plain-object form for JSON persistence. */
  serialize() {
    /** @type {Record<string, DeckEntry>} */
    const out = {};
    for (const [k, v] of this.decks) out[k] = { trusted: v.trusted, lastOpenMs: v.lastOpenMs, approvals: [...v.approvals] };
    return out;
  }

  /** Rebuild from serialize() output (or a parsed JSON object). Tolerant of junk. */
  static deserialize(obj) {
    return new TrustLedger(obj && typeof obj === 'object' ? obj : {});
  }
}

function uniq(arr) {
  return Array.isArray(arr) ? [...new Set(arr.filter((x) => typeof x === 'string'))] : [];
}

function normalizeEntry(v) {
  return {
    trusted: !!(v && v.trusted),
    lastOpenMs: v && Number.isFinite(v.lastOpenMs) ? v.lastOpenMs : 0,
    approvals: uniq(v && v.approvals),
  };
}
