import { describe, it, expect } from 'vitest';
import { TrustLedger, TRUST_TTL_MS } from './trustLedger.mjs';

const T0 = 1_000_000_000_000;       // a fixed "now"
const LATER = T0 + TRUST_TTL_MS + 1; // just past the TTL
const P = '/deck/figs/a.png';
const Q = '/deck/figs/b.png';

describe('TrustLedger — untrusted by default', () => {
  it('an unknown deck is untrusted-new with no approvals', () => {
    const l = new TrustLedger();
    expect(l.deckState('tok', T0)).toEqual({ status: 'untrusted-new', approvals: [], lapsed: false });
    expect(l.isTrusted('tok', T0)).toBe(false);
    expect(l.isApproved('tok', P, T0)).toBe(false);
  });
});

describe('createTrusted + approve', () => {
  it('File → New trusts the deck; approve authorizes a path', () => {
    const l = new TrustLedger();
    l.createTrusted('tok', T0);
    expect(l.isTrusted('tok', T0)).toBe(true);
    expect(l.isApproved('tok', P, T0)).toBe(false);   // nothing approved yet
    expect(l.approve('tok', P, T0)).toBe(true);
    expect(l.isApproved('tok', P, T0)).toBe(true);
    expect(l.isApproved('tok', Q, T0)).toBe(false);   // per-path
  });
  it('approve is a no-op on an untrusted deck', () => {
    const l = new TrustLedger();
    expect(l.approve('tok', P, T0)).toBe(false);
    expect(l.isApproved('tok', P, T0)).toBe(false);
  });
});

describe('trust a received deck (with reviewed paths)', () => {
  it('sets trust + the approved set at once', () => {
    const l = new TrustLedger();
    l.trust('tok', [P, Q, P], T0); // dupes collapse
    expect(l.isTrusted('tok', T0)).toBe(true);
    expect(l.deckState('tok', T0).approvals.sort()).toEqual([P, Q].sort());
  });
});

describe('TTL lapse and re-confirm', () => {
  it('lapses to untrusted-ttl with approvals retained but inactive', () => {
    const l = new TrustLedger();
    l.trust('tok', [P], T0);
    const s = l.deckState('tok', LATER);
    expect(s.status).toBe('untrusted-ttl');
    expect(s.approvals).toEqual([P]);           // retained
    expect(l.isApproved('tok', P, LATER)).toBe(false); // but inactive → no read
  });
  it('re-confirm restores the retained approvals (one action)', () => {
    const l = new TrustLedger();
    l.trust('tok', [P], T0);
    expect(l.reconfirm('tok', LATER)).toBe(true);
    expect(l.isTrusted('tok', LATER)).toBe(true);
    expect(l.isApproved('tok', P, LATER)).toBe(true);
  });
});

describe('open refreshes the TTL clock', () => {
  it('opening a trusted deck within the TTL pushes the clock forward', () => {
    const l = new TrustLedger();
    l.trust('tok', [P], T0);
    // open near the end of the window → refreshes lastOpen
    const nearEnd = T0 + TRUST_TTL_MS - 1;
    expect(l.open('tok', nearEnd)).toBe('trusted');
    // now well past the ORIGINAL window but within a fresh one → still trusted
    expect(l.isTrusted('tok', nearEnd + TRUST_TTL_MS - 1)).toBe(true);
  });
  it('opening a lapsed deck does NOT refresh (stays untrusted-ttl until re-confirm)', () => {
    const l = new TrustLedger();
    l.trust('tok', [P], T0);
    expect(l.open('tok', LATER)).toBe('untrusted-ttl');
    expect(l.isTrusted('tok', LATER)).toBe(false);
  });
});

describe('revoke removes approvals', () => {
  it('revoked deck is untrusted-new (approve from scratch)', () => {
    const l = new TrustLedger();
    l.trust('tok', [P], T0);
    l.revoke('tok');
    expect(l.deckState('tok', T0)).toEqual({ status: 'untrusted-new', approvals: [], lapsed: false });
  });
});

describe('serialize / deserialize', () => {
  it('round-trips state', () => {
    const l = new TrustLedger();
    l.trust('tok', [P, Q], T0);
    const round = TrustLedger.deserialize(JSON.parse(JSON.stringify(l.serialize())));
    expect(round.isApproved('tok', P, T0)).toBe(true);
    expect(round.deckState('tok', T0).approvals.sort()).toEqual([P, Q].sort());
  });
  it('deserialize tolerates junk', () => {
    expect(TrustLedger.deserialize(null).isTrusted('x', T0)).toBe(false);
    const l = TrustLedger.deserialize({ tok: { trusted: true, lastOpenMs: T0, approvals: [P, 5, null] } });
    expect(l.deckState('tok', T0).approvals).toEqual([P]); // non-strings dropped
  });
});
