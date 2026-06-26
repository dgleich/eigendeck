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
  `<span style="letter-spacing:0.22em;text-transform:uppercase;font-weight:700;font-size:0.92em">${txt}</span>`;

// ===========================================================================
// 1 — Eckart–Young (Libertinus Serif · cream paper)
// ===========================================================================
function slideEckartYoung() {
  const card = R`<div style="background:#efe7d6;border-left:10px solid #b07a2a;border-radius:12px;padding:30px 46px;box-shadow:0 8px 30px rgba(60,40,10,0.10)">
  <div style="font-weight:700;color:#a25e12;margin-bottom:12px;font-size:0.92em;letter-spacing:0.02em">Theorem · Eckart–Young–Mirsky</div>
  <div style="margin:6px 0">Let $A\in\mathbb{R}^{m\times n}$ have the singular value decomposition $A=U\Sigma V^{\top}$ with $\sigma_1\ge\sigma_2\ge\cdots\ge\sigma_r>0$. For every $k<r$, the truncated SVD</div>
  $$A_k=\sum_{i=1}^{k}\sigma_i\,u_i v_i^{\top}$$
  <div style="margin:6px 0">is the closest rank-$k$ matrix to $A$ in every unitarily invariant norm, and the error is set exactly by the discarded singular values:</div>
  $$\lVert A-A_k\rVert_2=\sigma_{k+1},\qquad \lVert A-A_k\rVert_F=\Bigl(\sum_{i>k}\sigma_i^{2}\Bigr)^{1/2}.$$
</div>`;
  return {
    id: 'tx-eckart', theme: 'light', titleFont: 'libertinus', bodyFont: 'libertinus',
    notes: 'Typeset theorem (no demo) — Libertinus Serif on a cream "paper" theme.',
    elements: [
      el({ id: 'eckart-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#1e5c99', html: eyebrow('Mathematics · Numerical Linear Algebra') }),
      el({ id: 'eckart-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'The best low-rank approximation' }),
      el({ id: 'eckart-card', x: 150, y: 296, w: 1620, h: 600, fontSize: 34, color: '#2c2418', html: card }),
      el({ id: 'eckart-foot', x: 152, y: 936, w: 1620, h: 72, fontSize: 26, color: '#8c7e6a', html: R`Exactly why the low-rank image demo compresses so well — and why reorganizing the image into a matrix of tiles lowers $\sigma_{k+1}$ at equal storage (Gleich, 2024).` }),
    ],
  };
}

// ===========================================================================
// 2 — Maxwell's equations (Computer Modern Concrete · dark)
// ===========================================================================
function slideMaxwell() {
  const cell = (name, tex) => R`<div style="background:rgba(255,255,255,0.045);border:1px solid rgba(96,165,250,0.30);border-radius:16px;padding:18px 24px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">
  <div style="color:#7cb0ff;font-size:0.52em;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2px;text-align:center">${name}</div>
  $$${tex}$$
</div>`;
  const C = (id, x, y, html) => el({ id, x, y, w: 780, h: 286, fontSize: 40, color: '#eaf0ff', html });
  return {
    id: 'tx-maxwell', theme: 'dark', titleFont: 'concrete-euler', bodyFont: 'concrete-euler',
    notes: "Four-up equation grid — Computer Modern Concrete on a dark theme.",
    elements: [
      el({ id: 'mx-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#60a5fa', html: eyebrow('Physics · Classical Electromagnetism') }),
      el({ id: 'mx-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: "Maxwell's equations" }),
      C('mx-gauss', 150, 300, cell("Gauss's law", R`\nabla\!\cdot\mathbf{E}=\dfrac{\rho}{\varepsilon_0}`)),
      C('mx-nomono', 990, 300, cell('No magnetic monopoles', R`\nabla\!\cdot\mathbf{B}=0`)),
      C('mx-faraday', 150, 606, cell('Faraday — induction', R`\nabla\times\mathbf{E}=-\dfrac{\partial\mathbf{B}}{\partial t}`)),
      C('mx-ampere', 990, 606, cell('Ampère–Maxwell', R`\nabla\times\mathbf{B}=\mu_0\mathbf{J}+\mu_0\varepsilon_0\dfrac{\partial\mathbf{E}}{\partial t}`)),
      el({ id: 'mx-foot', x: 150, y: 922, w: 1620, h: 96, fontSize: 30, color: '#c7d4ee', html: ctr(R`In vacuum the fields obey $\partial_t^2\mathbf{E}=c^2\nabla^2\mathbf{E}$ — a wave at speed $c=1/\sqrt{\mu_0\varepsilon_0}$. Light <em>is</em> electromagnetism.`) }),
    ],
  };
}

// ===========================================================================
// 3 — The Master Theorem (Source Sans 3 prose + Source Code Pro mono · white)
// ===========================================================================
function slideMasterTheorem() {
  const intro = R`<div style="background:#eef3fb;border-radius:12px;padding:24px 40px;box-shadow:0 6px 24px rgba(20,40,80,0.08)">
  <div style="margin-bottom:2px">For a divide-and-conquer recurrence with $a\ge 1$ subproblems of size $n/b$ (here $b>1$), set $c=\log_b a$ and compare $f(n)$ with $n^{c}$:</div>
  $$T(n)=a\,T\!\left(\frac{n}{b}\right)+f(n)$$
</div>`;
  const caseCard = (label, cond, result) => R`<div style="background:#fff;border:1px solid #d6e0f0;border-top:6px solid #2563eb;border-radius:12px;padding:20px 24px;height:100%;box-sizing:border-box;box-shadow:0 6px 20px rgba(20,40,80,0.06)">
  <div style="color:#2563eb;font-weight:700;margin-bottom:10px;font-size:0.78em;letter-spacing:0.03em">${label}</div>
  <div style="margin-bottom:6px">${cond}</div>
  $$${result}$$
</div>`;
  const CC = (id, x, html) => el({ id, x, y: 548, w: 520, h: 296, fontSize: 30, color: '#1f2933', html });
  const codeBox = R`<div style="display:inline-block;background:#0f172a;color:#7ee2b8;font-family:inherit;padding:14px 28px;border-radius:10px;font-size:0.82em">merge sort:&nbsp; T(n) = 2&middot;T(n/2) + &Theta;(n) &nbsp;&rArr;&nbsp; &Theta;(n log n)</div>`;
  return {
    id: 'tx-master', theme: 'white', titleFont: 'source-sans', bodyFont: 'source-sans', hypeFont: 'source-code',
    notes: 'Three-case theorem layout — Source Sans 3 prose, Source Code Pro for the code line.',
    elements: [
      el({ id: 'mt-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#2563eb', html: eyebrow('Computer Science · Analysis of Algorithms') }),
      el({ id: 'mt-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'The Master Theorem' }),
      el({ id: 'mt-intro', x: 150, y: 300, w: 1620, h: 210, fontSize: 34, color: '#1f2933', html: intro }),
      CC('mt-c1', 150, caseCard('1 · Leaves dominate', R`If $f(n)=O\!\left(n^{c-\epsilon}\right)$,`, R`T(n)=\Theta\!\left(n^{c}\right)`)),
      CC('mt-c2', 700, caseCard('2 · Balanced', R`If $f(n)=\Theta\!\left(n^{c}\right)$,`, R`T(n)=\Theta\!\left(n^{c}\log n\right)`)),
      CC('mt-c3', 1250, caseCard('3 · Root dominates', R`If $f(n)=\Omega\!\left(n^{c+\epsilon}\right)$ &amp; $a\,f(n/b)\le\kappa f(n)$,`, R`T(n)=\Theta\!\left(f(n)\right)`)),
      el({ id: 'mt-code', preset: 'hype', x: 150, y: 902, w: 1620, h: 80, fontSize: 36, color: '#0f172a', html: ctr(codeBox) }),
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
      el({ id: 'q-eyebrow', x: 150, y: 322, w: 1620, h: 50, fontSize: 28, color: '#b8556b', html: ctr(eyebrow('Computer Science · on the point of it all')) }),
      el({ id: 'q-quote', preset: 'title', x: 180, y: 412, w: 1560, h: 380, fontSize: 108, color: '#7a3b4e', html: ctr('&ldquo;The purpose of computing is insight, not numbers.&rdquo;') }),
      el({ id: 'q-attr', x: 150, y: 802, w: 1620, h: 80, fontSize: 46, color: '#a86077', html: ctr('&mdash; Richard W. Hamming') }),
    ],
  };
}

// ===========================================================================
// 5 — Cauchy–Schwarz (Computer Modern Sans · black)
// ===========================================================================
function slideCauchySchwarz() {
  const proof = R`<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(147,197,253,0.30);border-radius:16px;padding:26px 44px">
  <div style="color:#93c5fd;font-weight:700;margin-bottom:8px;font-size:0.82em;letter-spacing:0.04em">Proof</div>
  <div style="margin-bottom:4px">For every real $t$, expand the non-negative quantity $\lVert x-t\,y\rVert^{2}=\lVert x\rVert^{2}-2t\,\langle x,y\rangle+t^{2}\lVert y\rVert^{2}\ge 0$. A quadratic in $t$ that is never negative has discriminant $\le 0$:</div>
  $$\langle x,y\rangle^{2}\le\lVert x\rVert^{2}\,\lVert y\rVert^{2}.$$
  <div style="text-align:right;font-size:0.9em">&#9632;</div>
</div>`;
  return {
    id: 'tx-cauchy', theme: 'black', titleFont: 'lm-sans', bodyFont: 'lm-sans',
    notes: 'Statement + one-line proof — Computer Modern Sans on a black theme.',
    elements: [
      el({ id: 'cs-eyebrow', x: 152, y: 86, w: 1620, h: 46, fontSize: 26, color: '#93c5fd', html: eyebrow('Mathematics · Inequalities') }),
      el({ id: 'cs-title', preset: 'title', x: 150, y: 116, w: 1620, h: 120, html: 'Cauchy–Schwarz' }),
      el({ id: 'cs-eq', x: 150, y: 326, w: 1620, h: 200, fontSize: 80, color: '#ffffff', html: R`$$\bigl|\langle x,\,y\rangle\bigr|\;\le\;\lVert x\rVert\,\lVert y\rVert$$` }),
      el({ id: 'cs-proof', x: 360, y: 580, w: 1200, h: 300, fontSize: 32, color: '#d7def0', html: proof }),
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
