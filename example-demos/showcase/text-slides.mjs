// Text-heavy "gorgeous slide" gallery for the Eigendeck showcase.
//
// The point: Eigendeck isn't only for interactive demos — a plain slide of
// typeset mathematics, set in the right font on the right background, should
// look beautiful too. Each slide here deliberately uses a DIFFERENT font family
// + theme so the deck shows the range:
//
//   1. Eckart–Young theorem   — Libertinus Serif, cream "paper" theme
//   2. Maxwell's equations     — Computer Modern Concrete, dark theme
//   3. The Master Theorem      — Source Sans 3 prose + Source Code Pro mono, white
//   4. Hamming quote           — Shantell Sans (handwritten), soft-rose full bleed
//   5. Cauchy–Schwarz          — Computer Modern Sans, black theme
//
// Every equation is a real LaTeX TEXT element (click in the app to edit the
// source); MathJax renders it in the app AND in the headless export, picking the
// math-font pack that matches the slide's body font. Per-slide `theme` and
// `bodyFont`/`titleFont`/`hypeFont` round-trip through `eigendeck-cli import json`
// (build_slide_config_json) and the exporter embeds the fonts it sees in use.
//
// LaTeX backslashes: these strings are tagged with String.raw (`R`), so write a
// SINGLE backslash for every TeX command (\sigma, not \\sigma). Keep inline
// $...$ on one source line (the renderer rejects a newline inside inline math);
// display $$...$$ may span lines.

const R = String.raw;
const ctr = (h) => `<div style="text-align:center">${h}</div>`;

// text-element helper: el({id,preset,x,y,w,h, html, color, fontSize, ...})
function el({ id, preset = 'body', x, y, w, h, ...rest }) {
  return { id, type: 'text', preset, position: { x, y, width: w, height: h }, ...rest };
}
const eyebrow = (txt) =>
  `<span style="letter-spacing:0.22em;text-transform:uppercase;font-weight:700">${txt}</span>`;
// a blank line — toolbar-authorable spacing (Enter on an empty line). Used in
// place of CSS margins, which the rich-text sanitizer strips.
const GAP = '<div><br></div>';
// caps/letter-spaced accent label kept at the SAME font size as its body (native
// text formatting: colour + caps + tracking, no size change).
const label = (txt) =>
  `<span style="text-transform:uppercase;letter-spacing:0.1em;font-weight:700">${txt}</span>`;
// an empty rounded-fill text box used purely as a card background; layer text
// boxes on top. backgroundColor + borderRadius are both native element fields.
const panel = (id, x, y, w, h, bg, { shadow = false, radius = 18 } = {}) =>
  el({ id, x, y, w, h, backgroundColor: bg, borderRadius: radius, boxShadow: shadow || undefined, html: '' });

// ===========================================================================
// 1 — Eckart–Young (Libertinus Serif · cream paper)
// ===========================================================================
function slideEckartYoung() {
  // The card is built natively: an empty rounded-fill PANEL element + one text
  // box layered on top (inset for breathing room). No stroke, no accent bar. The
  // "Theorem ·…" label stays the SAME font size as the body — just accent colour
  // + caps + letter-spacing (all native text-toolbar formatting), so the whole
  // box is one font size.
  const card = R`<div style="color:#a25e12;font-weight:700;text-transform:uppercase;letter-spacing:0.14em">Theorem &middot; Eckart–Young–Mirsky</div>${GAP}
<div>Let $A\in\mathbb{R}^{m\times n}$ have the singular value decomposition $A=U\Sigma V^{\top}$ with $\sigma_1\ge\sigma_2\ge\cdots\ge\sigma_r\gt 0$. For every $k\lt r,$ the truncated SVD</div>
$$A_k=\sum_{i=1}^{k}\sigma_i\,u_i v_i^{\top}$$
<div>is the closest rank-$k$ matrix to $A$ in every unitarily invariant norm, and the error is set exactly by the discarded singular values:</div>
$$\lVert A-A_k\rVert_2=\sigma_{k+1},\qquad \lVert A-A_k\rVert_F=\Bigl(\sum_{i\gt k}\sigma_i^{2}\Bigr)^{1/2}.$$`;
  return {
    id: 'tx-eckart', theme: 'light', titleFont: 'libertinus', bodyFont: 'libertinus',
    notes: 'Typeset theorem (no demo) — Libertinus Serif on a cream "paper" theme. Card = rounded-fill panel + a text box on top (native borderRadius, no strokes).',
    elements: [
      el({ id: 'eckart-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#1e5c99', html: eyebrow('Mathematics · Numerical Linear Algebra') }),
      el({ id: 'eckart-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'The best low-rank approximation' }),
      // rounded-fill panel (empty text box used as a colour card) + inset text box
      el({ id: 'eckart-panel', x: 150, y: 296, w: 1620, h: 540, backgroundColor: '#efe7d6', borderRadius: 18, boxShadow: true, html: '' }),
      el({ id: 'eckart-card', x: 196, y: 320, w: 1528, h: 492, fontSize: 34, color: '#2c2418', verticalAlign: 'middle', html: card }),
    ],
  };
}

// ===========================================================================
// 2 — Maxwell's equations (Computer Modern Concrete · dark)
// ===========================================================================
function slideMaxwell() {
  // Each cell = a rounded-fill panel + a small caps name box + the equation box
  // (name and equation are separate boxes → each one font size; no strokes).
  const cell = (key, cx, cy, name, tex) => [
    panel(`mx-${key}-bg`, cx, cy, 780, 286, 'rgba(255,255,255,0.06)', { radius: 20 }),
    el({ id: `mx-${key}-name`, x: cx, y: cy + 28, w: 780, h: 40, fontSize: 24, color: '#7cb0ff', html: ctr(`<span style="text-transform:uppercase;letter-spacing:0.12em;font-weight:600">${name}</span>`) }),
    el({ id: `mx-${key}-eq`, x: cx, y: cy + 76, w: 780, h: 186, fontSize: 48, color: '#eaf0ff', verticalAlign: 'middle', html: R`$$${tex}$$` }),
  ];
  return {
    id: 'tx-maxwell', theme: 'dark', titleFont: 'concrete-euler', bodyFont: 'concrete-euler',
    notes: "Four-up equation grid — Computer Modern Concrete on a dark theme. Each cell = rounded-fill panel + name box + equation box (native borderRadius, no strokes).",
    elements: [
      el({ id: 'mx-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#60a5fa', html: eyebrow('Physics · Classical Electromagnetism') }),
      el({ id: 'mx-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: "Maxwell's equations" }),
      ...cell('gauss', 150, 300, "Gauss's law", R`\nabla\!\cdot\mathbf{E}=\dfrac{\rho}{\varepsilon_0}`),
      ...cell('nomono', 990, 300, 'No magnetic monopoles', R`\nabla\!\cdot\mathbf{B}=0`),
      ...cell('faraday', 150, 606, 'Faraday — induction', R`\nabla\times\mathbf{E}=-\dfrac{\partial\mathbf{B}}{\partial t}`),
      ...cell('ampere', 990, 606, 'Ampère–Maxwell', R`\nabla\times\mathbf{B}=\mu_0\mathbf{J}+\mu_0\varepsilon_0\dfrac{\partial\mathbf{E}}{\partial t}`),
      el({ id: 'mx-foot', x: 150, y: 922, w: 1620, h: 96, fontSize: 30, color: '#c7d4ee', html: ctr(R`In vacuum the fields obey $\partial_t^2\mathbf{E}=c^2\nabla^2\mathbf{E}$ — a wave at speed $c=1/\sqrt{\mu_0\varepsilon_0}$. Light <em>is</em> electromagnetism.`) }),
    ],
  };
}

// ===========================================================================
// 3 — The Master Theorem (Source Sans 3 prose + Source Code Pro mono · white)
// ===========================================================================
function slideMasterTheorem() {
  const intro = R`<div>For a divide-and-conquer recurrence with $a\ge 1$ subproblems of size $n/b$ (here $b\gt 1$), set $c=\log_b a$ and compare $f(n)$ with $n^{c}$:</div>
$$T(n)=a\,T\!\left(\frac{n}{b}\right)+f(n)$$`;
  // each case = a rounded-fill panel + one text box (label inline at body size,
  // accent + caps; condition + result all one font size). No top accent bar.
  const caseCard = (key, cx, lbl, cond, result) => {
    const html = R`<div style="color:#2563eb">${label(lbl)}</div>${GAP}
<div>${cond}</div>
$$${result}$$`;
    return [
      panel(`mt-${key}-bg`, cx, 540, 520, 300, '#eef3fb', { shadow: true, radius: 16 }),
      el({ id: `mt-${key}`, x: cx + 32, y: 562, w: 456, h: 256, fontSize: 30, color: '#1f2933', html }),
    ];
  };
  return {
    id: 'tx-master', theme: 'white', titleFont: 'source-sans', bodyFont: 'source-sans',
    notes: 'Three-case theorem layout — Source Sans 3 prose, Source Code Pro code chip. Cards = rounded-fill panels + text boxes (native borderRadius, no strokes/bars).',
    elements: [
      el({ id: 'mt-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#2563eb', html: eyebrow('Computer Science · Analysis of Algorithms') }),
      el({ id: 'mt-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'The Master Theorem' }),
      panel('mt-intro-bg', 150, 300, 1620, 200, '#eef3fb', { shadow: true, radius: 16 }),
      el({ id: 'mt-intro', x: 190, y: 318, w: 1540, h: 164, fontSize: 34, color: '#1f2933', verticalAlign: 'middle', html: intro }),
      ...caseCard('c1', 150, '1 · Leaves dominate', R`If $f(n)=O\!\left(n^{c-\epsilon}\right)$,`, R`T(n)=\Theta\!\left(n^{c}\right)`),
      ...caseCard('c2', 700, '2 · Balanced', R`If $f(n)=\Theta\!\left(n^{c}\right)$,`, R`T(n)=\Theta\!\left(n^{c}\log n\right)`),
      ...caseCard('c3', 1250, '3 · Root dominates', R`If $f(n)=\Omega\!\left(n^{c+\epsilon}\right)$ &amp; $a\,f(n/b)\le\kappa f(n)$,`, R`T(n)=\Theta\!\left(f(n)\right)`),
      // code chip = a single text box with its own dark rounded fill; the code is
      // a <code> run (toolbar </> button), rendered in the deck mono font.
      el({ id: 'mt-code', x: 560, y: 892, w: 800, h: 84, fontSize: 34, color: '#7ee2b8', backgroundColor: '#0f172a', borderRadius: 12, verticalAlign: 'middle', html: ctr('<code>merge sort:&nbsp; T(n) = 2&middot;T(n/2) + &Theta;(n) &nbsp;&rArr;&nbsp; &Theta;(n log n)</code>') }),
    ],
  };
}

// ===========================================================================
// 4 — Hamming quote (Shantell Sans · soft-rose full bleed)
// ===========================================================================
function slideQuote() {
  return {
    id: 'tx-quote', theme: 'white', titleFont: 'shantell', bodyFont: 'shantell',
    notes: 'Typography flex / opener — Shantell Sans on a custom soft-rose background.',
    elements: [
      // full-bleed soft-rose background (a text element used purely as a colour panel)
      el({ id: 'q-bg', x: 0, y: 0, w: 1920, h: 1080, backgroundColor: '#fbeef2', html: '' }),
      el({ id: 'q-quote', preset: 'title', x: 180, y: 300, w: 1560, h: 380, fontSize: 108, verticalAlign: 'middle', color: '#7a3b4e', html: ctr('&ldquo;The purpose of computing is insight, not numbers.&rdquo;') }),
      el({ id: 'q-attr', x: 150, y: 712, w: 1620, h: 80, fontSize: 46, color: '#a86077', html: ctr('&mdash; Richard W. Hamming') }),
    ],
  };
}

// ===========================================================================
// 5 — Cauchy–Schwarz (Computer Modern Sans · black)
// ===========================================================================
function slideCauchySchwarz() {
  // proof = rounded-fill panel + one text box ("Proof" label inline at body size,
  // accent + caps; prose + display math + ∎ all one font size). No stroke.
  const proof = R`<div style="color:#93c5fd">${label('Proof')}</div>${GAP}
<div>For every real $t$, expand the non-negative quantity $\lVert x-t\,y\rVert^{2}=\lVert x\rVert^{2}-2t\,\langle x,y\rangle+t^{2}\lVert y\rVert^{2}\ge 0$. A quadratic in $t$ that is never negative has discriminant $\le 0$:</div>
$$\langle x,y\rangle^{2}\le\lVert x\rVert^{2}\,\lVert y\rVert^{2}.$$
<div style="text-align:right">&#9632;</div>`;
  return {
    id: 'tx-cauchy', theme: 'black', titleFont: 'lm-sans', bodyFont: 'lm-sans',
    notes: 'Statement + one-line proof — Computer Modern Sans on a black theme. Proof box = rounded-fill panel + text box (native borderRadius, no strokes).',
    elements: [
      el({ id: 'cs-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#93c5fd', html: eyebrow('Mathematics · Inequalities') }),
      el({ id: 'cs-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'Cauchy–Schwarz' }),
      el({ id: 'cs-eq', x: 150, y: 326, w: 1620, h: 200, fontSize: 80, color: '#ffffff', html: R`$$\bigl|\langle x,\,y\rangle\bigr|\;\le\;\lVert x\rVert\,\lVert y\rVert$$` }),
      panel('cs-proof-bg', 360, 566, 1200, 340, 'rgba(255,255,255,0.05)', { radius: 18 }),
      el({ id: 'cs-proof', x: 404, y: 590, w: 1112, h: 292, fontSize: 32, color: '#d7def0', verticalAlign: 'middle', html: proof }),
      el({ id: 'cs-foot', x: 152, y: 916, w: 1620, h: 60, fontSize: 26, color: '#9ca3af', html: ctr(R`Equality holds exactly when $x$ and $y$ are linearly dependent.`) }),
    ],
  };
}

export function buildTextSlides() {
  return [
    slideEckartYoung(),
    slideMaxwell(),
    slideMasterTheorem(),
    slideQuote(),
    slideCauchySchwarz(),
  ];
}
