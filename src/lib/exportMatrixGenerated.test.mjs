// GENERATED style matrix — the tier-2 (pairwise) and tier-3 (full cartesian) half
// of the export/print coverage. (Tier 1, one assertion per option, is the
// hand-written exportMatrix.test.mjs.)
//
// A style option SPACE is declared once per element; the pairwise generator emits
// the minimal set of cases covering every PAIR of option values, and each case
// asserts that EVERY active option still produces its expected signature in BOTH
// static paths (buildExportHtml CLI wiring + buildPrintSlideHtml). Interaction
// bugs — "option A silently drops option B" — surface here.
//
//   npx vitest run src/lib/exportMatrixGenerated.test.mjs          # pairwise (default)
//   EIGENDECK_FULL_MATRIX=1 npx vitest run src/lib/exportMatrixGenerated.test.mjs  # full cartesian
import { describe, it, expect } from 'vitest';
import { allPairs, full } from './pairwise.mjs';
import { buildExportHtml } from './exportCore.mjs';
import { buildPrintSlideHtml } from './printSlideHtml';

const FULL = process.env.EIGENDECK_FULL_MATRIX === '1';
const gen = FULL ? full : allPairs;

async function exportHtml(elements, opts = {}) {
  const slide = { id: 's1', theme: undefined, layout: 'default', notes: '', elements };
  const presentation = { title: 'M', theme: opts.theme || 'white', config: { width: 1920, height: 1080, ...(opts.config || {}) }, slides: [slide] };
  return buildExportHtml({ presentation, readFile: async () => new Uint8Array([]), readTextFile: async () => '', renderMath: null, applyMathPreamble: null, ...opts.wiring });
}
function printHtml(elements, opts = {}) {
  const slide = { id: 's1', theme: undefined, layout: 'default', notes: '', elements };
  const presentation = { title: 'M', theme: opts.theme || 'white', config: { width: 1920, height: 1080 }, slides: [slide] };
  return buildPrintSlideHtml(slide, presentation, new Map(), new Map());
}
const T = (over = {}) => ({ id: 't', type: 'text', preset: 'body', html: 'Hello', position: { x: 10, y: 20, width: 300, height: 100 }, ...over });

function assertSig(h, sig, label) {
  if (sig == null) return;
  if (sig instanceof RegExp) expect(h, label).toMatch(sig);
  else expect(h, label).toContain(sig);
}

// Each option: its values, the element overrides it applies, and the signature it
// must produce per path. Signatures are case-aware (2nd arg = the whole case) so a
// box-only style (shadow / radius) is only asserted when a background is present.
const TEXT_SPEC = {
  bg: {
    values: ['none', 'solid', 'translucent'],
    over: (v) => v === 'solid' ? { backgroundColor: '#eeeeee' } : v === 'translucent' ? { backgroundColor: '#ff0000', backgroundOpacity: 0.5 } : {},
    exp: (v) => v === 'solid' ? 'background:#' : v === 'translucent' ? 'background:rgba(255, 0, 0, 0.5)' : null,
    prn: (v) => v === 'solid' ? 'background:#' : v === 'translucent' ? 'background:rgba(255, 0, 0, 0.5)' : null,
  },
  shadow: {
    values: [false, true],
    over: (v) => v ? { boxShadow: true } : {},
    exp: (v, c) => v && c.bg !== 'none' ? 'box-shadow:0 4px 14px' : null,
    prn: (v, c) => v && c.bg !== 'none' ? 'box-shadow:0 4px 14px' : null,
  },
  radius: {
    values: [false, true],
    over: (v) => v ? { borderRadius: 16 } : {},
    exp: (v, c) => v && c.bg !== 'none' ? 'border-radius:16px' : null,
    prn: (v, c) => v && c.bg !== 'none' ? /border-radius:[\d.]+in/ : null,
  },
  valign: {
    values: ['top', 'middle'],
    over: (v) => v === 'middle' ? { verticalAlign: 'middle' } : {},
    exp: (v) => v === 'middle' ? 'justify-content:center' : null,
    prn: (v) => v === 'middle' ? 'justify-content:center' : null,
  },
  padding: {
    values: [false, true],
    over: (v) => v ? { padding: { top: 5, right: 7, bottom: 9, left: 11 } } : {},
    exp: (v) => v ? 'padding:5px 7px 9px 11px' : null,
    prn: (v) => v ? /padding:[\d.]+in/ : null,
  },
  effect: {
    values: [false, true],
    over: (v) => v ? { textEffect: 'glow' } : {},
    exp: (v) => v ? 'text-shadow:' : null,
    prn: (v) => v ? 'text-shadow:' : null,
  },
  rotation: {
    values: [false, true],
    over: (v) => v ? { rotation: 12 } : {},
    exp: (v) => v ? 'rotate(12deg)' : null,
    prn: (v) => v ? 'rotate(12deg)' : null,
  },
};

function runMatrix(name, spec, build) {
  const domains = Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, p.values]));
  const cases = gen(domains);
  describe(`${name} — ${FULL ? 'FULL cartesian' : 'pairwise'} (${cases.length} cases)`, () => {
    cases.forEach((c) => {
      it(JSON.stringify(c), async () => {
        const over = {};
        for (const [k, p] of Object.entries(spec)) Object.assign(over, p.over(c[k]));
        const el = build(over);
        const exp = await exportHtml([el]);
        const prn = printHtml([el]);
        for (const [k, p] of Object.entries(spec)) {
          assertSig(exp, p.exp(c[k], c), `export ${k}=${c[k]}`);
          assertSig(prn, p.prn(c[k], c), `print ${k}=${c[k]}`);
        }
      });
    });
  });
}

runMatrix('text style', TEXT_SPEC, T);
