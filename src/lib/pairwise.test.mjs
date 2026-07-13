import { describe, it, expect } from 'vitest';
import { single, allPairs, full } from './pairwise.mjs';

const P = { a: [1, 2, 3], b: ['x', 'y'], c: [true, false], d: ['p', 'q', 'r', 's'] };

describe('single', () => {
  it('covers every value of every param; count = max domain size', () => {
    const cs = single(P);
    expect(cs.length).toBe(4);   // max domain (d) = 4
    for (const name of Object.keys(P)) {
      const seen = new Set(cs.map((c) => c[name]));
      for (const v of P[name]) expect(seen.has(v)).toBe(true);
    }
  });
});

describe('allPairs', () => {
  it('covers EVERY pair of values across every pair of params', () => {
    const cs = allPairs(P);
    const ns = Object.keys(P);
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        for (const a of P[ns[i]]) {
          for (const b of P[ns[j]]) {
            const hit = cs.some((c) => c[ns[i]] === a && c[ns[j]] === b);
            expect(hit, `pair ${ns[i]}=${a} × ${ns[j]}=${b} uncovered`).toBe(true);
          }
        }
      }
    }
  });

  it('is far smaller than the full product', () => {
    const fullCount = full(P).length;     // 3*2*2*4 = 48
    expect(allPairs(P).length).toBeLessThan(fullCount);
    expect(allPairs(P).length).toBeGreaterThanOrEqual(12);   // ≥ max two domains (3*4)
  });
});

describe('full', () => {
  it('is the cartesian product', () => {
    expect(full(P).length).toBe(3 * 2 * 2 * 4);
    // every combination is unique
    const keys = new Set(full(P).map((c) => JSON.stringify(c)));
    expect(keys.size).toBe(48);
  });
});
