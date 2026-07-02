import { describe, it, expect } from 'vitest';
import { TrustLedger, TRUST_TTL_MS } from './trustLedger.mjs';

const T0 = 1_000_000_000_000;       // a fixed "now"
const LATER = T0 + TRUST_TTL_MS + 1; // just past the TTL
const P = '/deck/figs/a.png';
const Q = '/deck/figs/b.png';
const A1 = 'asset-1';
const A2 = 'asset-2';

describe('TrustLedger — untrusted by default', () => {
  it('an unknown deck is untrusted-new with no approvals', () => {
    const l = new TrustLedger();
    expect(l.deckState('tok', T0)).toEqual({ status: 'untrusted-new', approvals: [], lapsed: false });
    expect(l.isTrusted('tok', T0)).toBe(false);
    expect(l.isApproved('tok', P, T0)).toBe(false);
  });
});

describe('createTrusted + approve (asset-keyed)', () => {
  it('File → New trusts the deck; approve(asset, path) authorizes that path', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    expect(l.isTrusted('tok', T0)).toBe(true);
    expect(l.isApproved('tok', P, T0)).toBe(false);   // nothing approved yet
    expect(l.approve('tok', A1, P, T0)).toBe(true);
    expect(l.isApproved('tok', P, T0)).toBe(true);
    expect(l.isApproved('tok', Q, T0)).toBe(false);   // per-path (via resolved target)
  });
  it('approve is a no-op on an untrusted deck', () => {
    const l = new TrustLedger();
    expect(l.approve('tok', A1, P, T0)).toBe(false);
    expect(l.isApproved('tok', P, T0)).toBe(false);
  });
  it('re-approving the SAME asset replaces its path in place (relocate) — no orphan', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    l.approve('tok', A1, P, T0);      // approved at the old location
    l.approve('tok', A1, Q, T0);      // relocate: same asset, new resolved target
    expect(l.isApproved('tok', Q, T0)).toBe(true);   // new path authorized
    expect(l.isApproved('tok', P, T0)).toBe(false);  // OLD path dropped atomically
    expect(l.deckState('tok', T0).approvals).toEqual([Q]);
  });
  it('two assets can approve the SAME resolved path (ref-count); one stays after the other drops', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    l.approve('tok', A1, P, T0);
    l.approve('tok', A2, P, T0);
    l.reconcile('tok', [A2], T0);     // A1 no longer referenced
    expect(l.isApproved('tok', P, T0)).toBe(true);   // A2 still holds it
  });
});

describe('reconcile — drop approvals for unreferenced assets (ledger hygiene)', () => {
  it('removes approvals whose asset is no longer linked; keeps the rest', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    l.approve('tok', A1, P, T0);
    l.approve('tok', A2, Q, T0);
    expect(l.reconcile('tok', [A2], T0)).toBe(1);    // A1 dropped
    expect(l.isApproved('tok', P, T0)).toBe(false);
    expect(l.isApproved('tok', Q, T0)).toBe(true);   // still referenced → kept
  });
  it('keeps a still-referenced asset even if its file is currently missing', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    l.approve('tok', A1, P, T0);
    // A1 still referenced by the deck (its id is in keep) though the file may be gone
    expect(l.reconcile('tok', [A1], T0)).toBe(0);
    expect(l.isApproved('tok', P, T0)).toBe(true);
  });
  it('is a NO-OP on a TTL-lapsed deck (retained approvals survive for re-confirm)', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    expect(l.reconcile('tok', [], LATER)).toBe(0);   // lapsed → untouched
    expect(l.deckState('tok', LATER).approvals).toEqual([P]); // still retained
  });
});

describe('trust a received deck (with reviewed assets)', () => {
  it('sets trust + the approved set at once (assetId → resolved map)', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P, [A2]: Q }, T0);
    expect(l.isTrusted('tok', T0)).toBe(true);
    expect(l.deckState('tok', T0).approvals.sort()).toEqual([P, Q].sort());
  });
});

describe('TTL lapse and re-confirm', () => {
  it('lapses to untrusted-ttl with approvals retained but inactive', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    const s = l.deckState('tok', LATER);
    expect(s.status).toBe('untrusted-ttl');
    expect(s.approvals).toEqual([P]);           // retained
    expect(l.isApproved('tok', P, LATER)).toBe(false); // but inactive → no read
  });
  it('re-confirm restores the retained approvals (one action)', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    expect(l.reconfirm('tok', LATER)).toBe(true);
    expect(l.isTrusted('tok', LATER)).toBe(true);
    expect(l.isApproved('tok', P, LATER)).toBe(true);
  });
});

describe('open refreshes the TTL clock', () => {
  it('opening a trusted deck within the TTL pushes the clock forward', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    // open near the end of the window → refreshes lastOpen
    const nearEnd = T0 + TRUST_TTL_MS - 1;
    expect(l.open('tok', nearEnd)).toBe('trusted');
    // now well past the ORIGINAL window but within a fresh one → still trusted
    expect(l.isTrusted('tok', nearEnd + TRUST_TTL_MS - 1)).toBe(true);
  });
  it('opening a lapsed deck does NOT refresh (stays untrusted-ttl until re-confirm)', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    expect(l.open('tok', LATER)).toBe('untrusted-ttl');
    expect(l.isTrusted('tok', LATER)).toBe(false);
  });
});

describe('revoke removes approvals', () => {
  it('revoked deck is untrusted-new (approve from scratch)', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P }, T0);
    l.revoke('tok');
    expect(l.deckState('tok', T0)).toEqual({ status: 'untrusted-new', approvals: [], lapsed: false });
  });
});

describe('serialize / deserialize', () => {
  it('round-trips state', () => {
    const l = new TrustLedger();
    l.trust('tok', { [A1]: P, [A2]: Q }, T0);
    const round = TrustLedger.deserialize(JSON.parse(JSON.stringify(l.serialize())));
    expect(round.isApproved('tok', P, T0)).toBe(true);
    expect(round.deckState('tok', T0).approvals.sort()).toEqual([P, Q].sort());
  });
  it('deserialize tolerates junk', () => {
    expect(TrustLedger.deserialize(null).isTrusted('x', T0)).toBe(false);
    const l = TrustLedger.deserialize({ tok: { trusted: true, lastOpenMs: T0, approvals: { [A1]: P, bad: 5, worse: null } } });
    expect(l.deckState('tok', T0).approvals).toEqual([P]); // non-string values dropped
  });
});
