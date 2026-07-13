// Combinatorial test-case generation over a set of named parameters, each with a
// list of candidate values. Used to drive the export/print style matrix at three
// coverage levels (see exportMatrixGenerated.test.mjs):
//   • single    — each value of each parameter appears at least once (tier 1)
//   • allPairs  — every PAIR of values from any two parameters appears (tier 2)
//   • full      — the full cartesian product (tier 3, expanded env only)
//
// `params` is an object `{ name: [v0, v1, …] }`. Each generator returns an array
// of cases, where a case is `{ name: value }` for every parameter.

const names = (params) => Object.keys(params);

/** Each parameter value appears in ≥1 case; other params take their first value.
 *  Case count = max domain size. */
export function single(params) {
  const ns = names(params);
  const max = Math.max(0, ...ns.map((n) => params[n].length));
  const cases = [];
  for (let i = 0; i < max; i++) {
    const c = {};
    for (const n of ns) c[n] = params[n][Math.min(i, params[n].length - 1)];
    cases.push(c);
  }
  return cases;
}

/** All-pairs (pairwise): every (paramA=a, paramB=b) combination appears in ≥1
 *  case. Greedy set-cover over value INDICES (values may be any type). */
export function allPairs(params) {
  const ns = names(params);
  if (ns.length < 2) return single(params);
  const key = (i, a, j, b) => `${i}=${a}:${j}=${b}`;   // param index = value index
  const uncovered = new Set();
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      for (let a = 0; a < params[ns[i]].length; a++) {
        for (let b = 0; b < params[ns[j]].length; b++) uncovered.add(key(i, a, j, b));
      }
    }
  }
  const cases = [];
  while (uncovered.size) {
    const idx = new Array(ns.length).fill(-1);
    // Seed with any still-uncovered pair.
    const [seed] = uncovered;
    const m = seed.match(/^(\d+)=(\d+):(\d+)=(\d+)$/);
    idx[+m[1]] = +m[2]; idx[+m[3]] = +m[4];
    // Fill the rest greedily — pick the value covering the most uncovered pairs
    // against the already-chosen params.
    for (let i = 0; i < ns.length; i++) {
      if (idx[i] >= 0) continue;
      let best = 0, bestCov = -1;
      for (let a = 0; a < params[ns[i]].length; a++) {
        let cov = 0;
        for (let j = 0; j < ns.length; j++) {
          if (j === i || idx[j] < 0) continue;
          const [lo, la, hi, hb] = i < j ? [i, a, j, idx[j]] : [j, idx[j], i, a];
          if (uncovered.has(key(lo, la, hi, hb))) cov++;
        }
        if (cov > bestCov) { bestCov = cov; best = a; }
      }
      idx[i] = best;
    }
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) uncovered.delete(key(i, idx[i], j, idx[j]));
    }
    cases.push(Object.fromEntries(ns.map((n, k) => [n, params[n][idx[k]]])));
  }
  return cases;
}

/** Full cartesian product. Case count = product of all domain sizes (can be huge). */
export function full(params) {
  const ns = names(params);
  let cases = [{}];
  for (const n of ns) {
    const next = [];
    for (const c of cases) for (const v of params[n]) next.push({ ...c, [n]: v });
    cases = next;
  }
  return cases;
}

export const GENERATORS = { single, allPairs, full };
