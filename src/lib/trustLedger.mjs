// The trust ledger — app-side record of which decks are trusted and which resolved
// paths are approved for watching. See docs/ASSETS-SECURITY.md ("Trust store" +
// "State model"). This module is PURE state + logic: the current time is injected
// (`now` ms epoch) and persistence is external, so it is fully unit-testable and
// has no clock/DOM/fs dependency. A thin Tauri-fs layer (elsewhere) loads/saves it.
//
// Keyed by `deck-token` (a random id stamped into the deck at File → New; a received
// deck's token isn't in the ledger). Per deck we keep: whether it was ever trusted,
// the last-open time (for the TTL), and the approved *resolved* paths — keyed by the
// linked asset's id (`{ [assetId]: resolvedPath }`).
//
// Why key approvals by asset, not by path: an approval belongs to a linked asset, and
// the asset id is STABLE across relocate (only the path changes). So `approve` REPLACES
// an asset's entry in place — a relocate never orphans the old path — and `reconcile`
// can drop approvals for assets the deck no longer references (delete / re-link) with a
// plain id set-diff, no filesystem access, keeping a temporarily-missing-but-still-
// referenced asset's approval intact. The READ gate still authorizes by resolved
// target (symlink defense): isApproved checks whether ANY asset's resolved matches.
// See docs/ASSETS-SECURITY.md ("Ledger hygiene").
//
// Three nested levels live here only for the DECK/TRUST axis: whether a deck is
// trusted and whether a path is approved. Watching on/off and the asset-type gate
// live elsewhere (preferences + assetTypes.mjs).

export const TRUST_TTL_DAYS = 30;
export const TRUST_TTL_MS = TRUST_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} DeckEntry
 * @property {boolean} trusted       ever trusted (File → New, or explicitly trusted)
 * @property {number}  trustedAt     epoch ms the deck was first trusted (provenance)
 * @property {string}  trustReason   how it became trusted: 'file-new' | 'trusted'
 * @property {number}  lastOpenMs    epoch ms of last open — the TTL is measured from here
 * @property {Record<string,{resolved:string,at:number,reason:string}>} approvals
 *           assetId → { approved RESOLVED path, epoch ms approved, why (add | relocate |
 *           relocate-folder | approve | approve-folder | trust-all) } — provenance so
 *           the Security window can show when + how each file was approved.
 * @property {string[]} seenEligible  resolved eligible paths already surfaced by the
 *                                    on-open review nudge (to scope "new" vs "seen")
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
    if (!e || !e.trusted) return { status: 'untrusted-new', approvals: [], lapsed: false, trustedAt: null, trustReason: null };
    const lapsed = now - e.lastOpenMs > TRUST_TTL_MS;
    const approvals = uniq(Object.values(e.approvals).map((a) => a.resolved)); // resolved paths (deduped)
    return {
      status: lapsed ? 'untrusted-ttl' : 'trusted',
      approvals,
      lapsed,
      trustedAt: e.trustedAt,
      trustReason: e.trustReason,
    };
  }

  /** Provenance for one approved resolved path: { at, reason } or null. Trusted-only
   *  (a lapsed deck's retained approvals don't authorize, but their provenance is still
   *  useful in the re-confirm UI, so this returns them regardless of TTL). */
  approvalDetail(token, resolvedPath) {
    const e = this.decks.get(token);
    if (!e || !e.trusted) return null;
    for (const a of Object.values(e.approvals)) {
      if (a.resolved === resolvedPath) return { at: a.at, reason: a.reason };
    }
    return null;
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

  /** Is this deck's demo internet access blocked (per-deck local choice)?
   *  Independent of trust — settable even on an untrusted deck. */
  isInternetBlocked(token) {
    const e = this.decks.get(token);
    return !!(e && e.blockInternet);
  }

  /** Set the per-deck internet block. Creates a minimal (untrusted) entry if the
   *  deck has none yet, so the choice persists for any deck. Mutating; caller persists. */
  setInternetBlocked(token, blocked, now) {
    let e = this.decks.get(token);
    if (!e) {
      if (!blocked) return this; // nothing to store
      e = { trusted: false, trustedAt: 0, trustReason: 'trusted', lastOpenMs: now || 0, approvals: {}, seenEligible: [], blockInternet: true };
      this.decks.set(token, e);
    } else {
      e.blockInternet = !!blocked;
    }
    return this;
  }

  /** Is THIS demo (by assetId) blocked from the internet in this deck? Per-demo
   *  local choice, layered under the deck + global switches (any one blocks).
   *  Default false = a declared demo may reach its manifest hosts. */
  isDemoBlocked(token, assetId) {
    const e = this.decks.get(token);
    return !!(e && e.blockedDemos && e.blockedDemos.includes(assetId));
  }

  /** Allow/deny one demo's internet by assetId. Creates a minimal (untrusted)
   *  entry if the deck has none. Mutating; caller persists. */
  setDemoBlocked(token, assetId, blocked, now) {
    let e = this.decks.get(token);
    if (!e) {
      if (!blocked) return this; // nothing to store
      e = { trusted: false, trustedAt: 0, trustReason: 'trusted', lastOpenMs: now || 0, approvals: {}, seenEligible: [], blockInternet: false, blockedDemos: [] };
      this.decks.set(token, e);
    }
    if (!Array.isArray(e.blockedDemos)) e.blockedDemos = [];
    const has = e.blockedDemos.includes(assetId);
    if (blocked && !has) e.blockedDemos.push(assetId);
    else if (!blocked && has) e.blockedDemos = e.blockedDemos.filter((a) => a !== assetId);
    return this;
  }

  // --- transitions (mutating; callers persist afterward) --------------------

  /** File → New (or explicit trust): stamp a fresh trusted deck with no approvals yet.
   *  `reason` records HOW it was trusted ('file-new' by default, or 'trusted'). */
  createTrusted(token, now, reason = 'file-new') {
    this.decks.set(token, { trusted: true, trustedAt: now, trustReason: reason, lastOpenMs: now, approvals: {}, seenEligible: [] });
    return this;
  }

  /** Explicitly trust a (received) deck, approving the reviewed assets. `approvals`
   *  is an `{ assetId: resolvedPath }` map; each is stamped now + reason 'trusted'.
   *  Replaces any prior approval set. */
  trust(token, approvals, now) {
    const stamped = {};
    for (const [assetId, resolved] of Object.entries(approvals || {})) {
      if (typeof assetId === 'string' && typeof resolved === 'string') {
        stamped[assetId] = { resolved, at: now, reason: 'trusted' };
      }
    }
    this.decks.set(token, { trusted: true, trustedAt: now, trustReason: 'trusted', lastOpenMs: now, approvals: stamped, seenEligible: [] });
    return this;
  }

  /** Record the deck's currently-ELIGIBLE (unapproved, in-policy) resolved paths that
   *  the on-open review nudge surfaced, and report how many are NEW since last time.
   *  Lets the toast scope its wording — a trusted deck newly pointing at unreviewed
   *  content is the risk to call out ("N NEW files"), vs links you've already seen
   *  ("N files still…"). Mutating; caller persists. No-op unless effectively trusted. */
  noteEligible(token, resolvedPaths, now) {
    if (!this.isTrusted(token, now)) return { total: 0, newCount: 0 };
    const e = this.decks.get(token);
    const cur = uniq(resolvedPaths);
    const seen = new Set(e.seenEligible || []);
    const newCount = cur.reduce((n, p) => n + (seen.has(p) ? 0 : 1), 0);
    e.seenEligible = cur; // remember exactly what we surfaced this open
    return { total: cur.length, newCount };
  }

  /** Approve (or re-point) ONE asset's resolved target on an already-trusted deck.
   *  REPLACES any prior entry for that asset — so a relocate updates in place and the
   *  old path is dropped atomically, never orphaned. `reason` records HOW (add |
   *  relocate | relocate-folder | approve | approve-folder | trust-all). No-op (returns
   *  false) if the deck isn't effectively trusted right now. */
  approve(token, assetId, resolvedPath, reason, now) {
    if (!this.isTrusted(token, now)) return false;
    if (typeof assetId !== 'string' || typeof resolvedPath !== 'string') return false;
    this.decks.get(token).approvals[assetId] = { resolved: resolvedPath, at: now, reason: reason || 'approve' };
    return true;
  }

  /** Revoke ONE asset's approval (the per-file "Revoke approval" action) without
   *  touching deck trust or the other approvals. Returns true if an approval was
   *  removed. No-op unless effectively trusted. */
  unapprove(token, assetId, now) {
    if (!this.isTrusted(token, now)) return false;
    const e = this.decks.get(token);
    if (!e || !(assetId in e.approvals)) return false;
    delete e.approvals[assetId];
    return true;
  }

  /** Ledger hygiene: drop approvals for assets the deck no longer references.
   *  `keepAssetIds` = the deck's CURRENT linked asset ids. Returns the count removed.
   *  No-op unless effectively trusted — a TTL-lapsed deck's retained approvals are
   *  preserved for one-click re-confirm (the sole retain exception). A still-referenced
   *  but currently-missing asset keeps its approval (its id is still in keepAssetIds).
   *  See docs/ASSETS-SECURITY.md ("Ledger hygiene"). */
  reconcile(token, keepAssetIds, now) {
    if (!this.isTrusted(token, now)) return 0;
    const keep = new Set(keepAssetIds);
    const e = this.decks.get(token);
    let removed = 0;
    for (const id of Object.keys(e.approvals)) {
      if (!keep.has(id)) { delete e.approvals[id]; removed++; }
    }
    return removed;
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
    for (const [k, v] of this.decks) {
      const approvals = {};
      for (const [id, a] of Object.entries(v.approvals)) approvals[id] = { resolved: a.resolved, at: a.at, reason: a.reason };
      out[k] = { trusted: v.trusted, trustedAt: v.trustedAt, trustReason: v.trustReason, lastOpenMs: v.lastOpenMs, approvals, seenEligible: [...v.seenEligible], blockInternet: !!v.blockInternet, blockedDemos: [...(v.blockedDemos || [])] };
    }
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

/** Coerce a persisted/handed-in approvals value to a clean `{assetId: {resolved, at,
 *  reason}}` map. Accepts the current object form; also tolerates a bare `{assetId:
 *  resolvedString}` (older shape) → stamped with at:0, reason:'unknown'. Junk dropped. */
function normApprovals(a) {
  const out = {};
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    for (const [k, v] of Object.entries(a)) {
      if (typeof k !== 'string') continue;
      if (typeof v === 'string') {
        out[k] = { resolved: v, at: 0, reason: 'unknown' };
      } else if (v && typeof v === 'object' && typeof v.resolved === 'string') {
        out[k] = {
          resolved: v.resolved,
          at: Number.isFinite(v.at) ? v.at : 0,
          reason: typeof v.reason === 'string' ? v.reason : 'unknown',
        };
      }
    }
  }
  return out;
}

function normalizeEntry(v) {
  return {
    trusted: !!(v && v.trusted),
    trustedAt: v && Number.isFinite(v.trustedAt) ? v.trustedAt : (v && Number.isFinite(v.lastOpenMs) ? v.lastOpenMs : 0),
    trustReason: v && typeof v.trustReason === 'string' ? v.trustReason : 'trusted',
    lastOpenMs: v && Number.isFinite(v.lastOpenMs) ? v.lastOpenMs : 0,
    approvals: normApprovals(v && v.approvals),
    seenEligible: uniq(v && v.seenEligible),
    // Per-deck: block this deck's demos from the internet (independent of trust —
    // you can block a deck you don't otherwise trust). Default false (allowed).
    blockInternet: !!(v && v.blockInternet),
    // Per-demo: assetIds of demos in this deck denied internet individually
    // (layered under the deck + global switches). Default [] (all declared allowed).
    blockedDemos: uniq(v && v.blockedDemos),
  };
}
