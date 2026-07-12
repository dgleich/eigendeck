// Builds examples/html-showcase.eigendeck — a showcase of the raw-HTML element (#137).
//
// Each slide is (mostly) a single full-bleed `html` element demonstrating one
// technique the sandboxed, script-less, offline HTML element unlocks: CSS
// gradients & @keyframes animation, flexbox/grid layout, styled tables, inline
// SVG (graphs, gradients, markers), conic-gradient rings, a value-colored matrix
// heatmap, timelines, faux-syntax code blocks, and data: URI media.
//
// Emits a plain JSON deck (no external assets — the html lives inline in the
// element), then:  eigendeck-cli <deck> import json <this-output>.json
//
// Usage:  node tools/build_html_showcase.mjs > /tmp/html-showcase.json
//         eigendeck-cli examples/html-showcase.eigendeck import json /tmp/html-showcase.json
//
// Constraints respected (see src/lib/htmlElement.mjs CSP): no <script>, no
// network resources (data: URIs only), system-ui / ui-monospace / Georgia font
// stacks. `*{box-sizing:border-box}` and body{height:100%} are pre-applied by the
// srcdoc wrapper.

import { randomUUID as uuid } from 'node:crypto';
import zlib from 'node:zlib';

const FULL = { x: 0, y: 0, width: 1920, height: 1080 };

// A slide that is one full-bleed html element (+ optional extra elements).
function htmlSlide(html, { background, theme = 'black', extra = [] } = {}) {
  const el = { id: uuid(), type: 'html', html, position: FULL };
  if (background) el.background = background;
  return { id: uuid(), theme, notes: '', elements: [el, ...extra] };
}

const slides = [];

// ── 1. Title / hero ──────────────────────────────────────────────────────────
// Animated conic-gradient aurora behind a gradient-clipped headline. @keyframes
// spins the background and fades the subtitle up — all script-less.
slides.push(htmlSlide(`
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
  .hero { position:relative; height:100%; display:grid; place-items:center; overflow:hidden;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#070a18; }
  .aurora { position:absolute; width:2600px; height:2600px; border-radius:50%;
            background: conic-gradient(from 0deg, #6366f1, #22d3ee, #a855f7, #ec4899, #f59e0b, #6366f1);
            filter: blur(120px); opacity:.55; animation: spin 22s linear infinite; }
  .card { position:relative; text-align:center; padding:0 40px; animation: rise 1.1s ease-out both; }
  h1 { margin:0; font-size:150px; font-weight:800; letter-spacing:-4px; line-height:1;
       background:linear-gradient(100deg,#e0e7ff,#a5b4fc 40%,#f0abfc 70%,#fda4af);
       -webkit-background-clip:text; background-clip:text; color:transparent; }
  p  { margin:28px 0 0; font-size:40px; font-weight:500; color:#c7d2fe; letter-spacing:.5px; }
  .kicker { display:inline-block; margin-bottom:26px; padding:10px 22px; border-radius:999px;
            font-size:22px; font-weight:600; letter-spacing:3px; text-transform:uppercase;
            color:#a5f3fc; background:rgba(34,211,238,.12); border:1px solid rgba(34,211,238,.4); }
</style>
<div class="hero">
  <div class="aurora"></div>
  <div class="card">
    <span class="kicker">Eigendeck · raw HTML element</span>
    <h1>Design without limits</h1>
    <p>Sandboxed &nbsp;·&nbsp; script-less &nbsp;·&nbsp; offline &nbsp;·&nbsp; LLM-authorable</p>
  </div>
</div>`, { background: '#070a18' }));

// ── 2. Typography playground ─────────────────────────────────────────────────
slides.push(htmlSlide(`
<style>
  .wrap { height:100%; padding:70px 90px; background:#0b0f1a; color:#e5e7eb;
          font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; display:flex; flex-direction:column; gap:34px; }
  .grad { font-family: system-ui, sans-serif; font-weight:800; font-size:104px; letter-spacing:-3px; line-height:1;
          background:linear-gradient(90deg,#f472b6,#c084fc,#60a5fa,#34d399);
          -webkit-background-clip:text; background-clip:text; color:transparent; }
  .glow { font-family: system-ui, sans-serif; font-weight:700; font-size:60px; color:#fef08a;
          text-shadow: 0 0 8px rgba(250,204,21,.5), 0 0 34px rgba(250,204,21,.35); }
  .track { font-family: system-ui, sans-serif; font-weight:300; font-size:40px; letter-spacing:16px;
           text-transform:uppercase; color:#93c5fd; }
  .drop { font-size:34px; line-height:1.5; color:#cbd5e1; max-width:1400px; }
  .drop::first-letter { float:left; font-family: Georgia, serif; font-weight:700; font-size:130px;
           line-height:.8; padding:6px 18px 0 0; color:#f472b6; }
  .weights { font-family: system-ui, sans-serif; font-size:40px; display:flex; gap:40px; align-items:baseline; }
  .weights span { color:#e5e7eb; } .w1{font-weight:100} .w4{font-weight:400} .w7{font-weight:700} .w9{font-weight:900}
</style>
<div class="wrap">
  <div class="grad">Typographic range</div>
  <div class="weights"><span class="w1">Thin</span><span class="w4">Regular</span><span class="w7">Bold</span><span class="w9">Black</span></div>
  <div style="display:flex; gap:60px; align-items:center;">
    <div class="glow">Text glow</div>
    <div class="track">letter&nbsp;spacing</div>
  </div>
  <p class="drop"><span style="color:#e5e7eb">Gradient fills, layered text-shadow, tracked capitals and a drop-cap</span> — all pure CSS, rendered in a locked-down iframe with no fonts fetched from the network. The deck stays portable and offline.</p>
</div>`, { background: '#0b0f1a' }));

// ── 3. CSS Grid dashboard of metric cards ────────────────────────────────────
function metricCard(label, value, delta, accent, spark) {
  return `<div class="mc" style="--a:${accent}">
    <div class="mc-label">${label}</div>
    <div class="mc-val">${value}</div>
    <div class="mc-delta">${delta}</div>
    <div class="mc-spark">${spark}</div>
  </div>`;
}
function sparkline(pts, color) {
  const w = 260, h = 60, max = Math.max(...pts), min = Math.min(...pts);
  const xs = (i) => (i / (pts.length - 1)) * w;
  const ys = (v) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ');
  const area = `M0 ${h} ` + pts.map((v, i) => `L${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ') + ` L${w} ${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:60px;display:block">
    <path d="${area}" fill="${color}" opacity=".15"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
slides.push(htmlSlide(`
<style>
  .dash { height:100%; padding:64px 80px; background:radial-gradient(1200px 700px at 20% 0%, #172033, #0a0e1a);
          font-family: system-ui, sans-serif; color:#e5e7eb; display:flex; flex-direction:column; }
  .dash h2 { margin:0 0 8px; font-size:52px; font-weight:800; letter-spacing:-1px; }
  .dash .sub { color:#94a3b8; font-size:26px; margin:0 0 40px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); grid-auto-rows:1fr; gap:34px; flex:1; }
  .mc { background:rgba(148,163,184,.07); border:1px solid rgba(148,163,184,.16); border-radius:22px;
        padding:34px 36px; display:flex; flex-direction:column; gap:6px; position:relative; overflow:hidden; }
  .mc::before { content:""; position:absolute; inset:0 0 auto 0; height:5px; background:var(--a); }
  .mc-label { font-size:24px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:1.5px; }
  .mc-val { font-size:76px; font-weight:800; letter-spacing:-2px; line-height:1.05; }
  .mc-delta { font-size:28px; font-weight:700; color:var(--a); }
  .mc-spark { margin-top:auto; }
</style>
<div class="dash">
  <h2>Cluster utilization</h2>
  <p class="sub">Live-styled metric cards on a responsive CSS grid</p>
  <div class="grid">
    ${metricCard('Throughput', '2.4 TF/s', '▲ 12% w/w', '#34d399', sparkline([3,4,3,5,6,5,7,8,7,9], '#34d399'))}
    ${metricCard('GPU hours', '184k', '▲ 6% w/w', '#60a5fa', sparkline([2,3,3,4,4,5,6,6,7,8], '#60a5fa'))}
    ${metricCard('Queue wait', '38s', '▼ 21% w/w', '#f472b6', sparkline([9,8,8,6,5,5,4,3,3,2], '#f472b6'))}
    ${metricCard('Solves / hr', '9,120', '▲ 18% w/w', '#a78bfa', sparkline([4,5,4,6,7,6,8,9,8,10], '#a78bfa'))}
    ${metricCard('Residual', '1e-9', 'converged', '#fbbf24', sparkline([10,7,5,3,2,1.5,1.2,1.1,1.05,1], '#fbbf24'))}
    ${metricCard('Nodes up', '512 / 512', '100%', '#22d3ee', sparkline([8,8,8,7,8,8,8,8,8,8], '#22d3ee'))}
  </div>
</div>`, { background: '#0a0e1a' }));

// ── 4. Styled data table ─────────────────────────────────────────────────────
const tableRows = [
  ['CG',            'SPD',        '4,096²',  '0.42', '182',  false],
  ['GMRES(50)',     'nonsym',     '4,096²',  '0.61', '241',  false],
  ['BiCGStab',      'nonsym',     '4,096²',  '0.55', '206',  false],
  ['AMG-PCG',       'SPD',        '4,096²',  '0.09', '31',   true],
  ['Direct (LU)',   'general',    '4,096²',  '3.80', '1',    false],
  ['Chebyshev',     'SPD',        '4,096²',  '0.71', '340',  false],
];
slides.push(htmlSlide(`
<style>
  .tw { height:100%; padding:70px 100px; background:#0c1119; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:flex; flex-direction:column; }
  .tw h2 { margin:0 0 6px; font-size:52px; font-weight:800; letter-spacing:-1px; }
  .tw .cap { color:#94a3b8; font-size:26px; margin:0 0 34px; }
  table { width:100%; border-collapse:separate; border-spacing:0; font-size:31px; }
  thead th { text-align:left; padding:22px 28px; font-size:23px; text-transform:uppercase; letter-spacing:1.5px;
             color:#0b1220; background:linear-gradient(90deg,#38bdf8,#818cf8); font-weight:800; }
  thead th:first-child { border-radius:16px 0 0 0; } thead th:last-child { border-radius:0 16px 0 0; }
  tbody td { padding:22px 28px; border-bottom:1px solid rgba(148,163,184,.14); }
  tbody tr:nth-child(even) { background:rgba(148,163,184,.05); }
  tbody tr.hot { background:rgba(52,211,153,.14); box-shadow: inset 4px 0 0 #34d399; }
  tbody tr.hot td { color:#d1fae5; font-weight:700; }
  .num { text-align:right; font-variant-numeric:tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .tag { display:inline-block; padding:5px 14px; border-radius:999px; font-size:22px; font-weight:600;
         background:rgba(129,140,248,.16); color:#c7d2fe; }
  .best { display:inline-block; margin-left:12px; padding:4px 12px; border-radius:8px; font-size:20px; font-weight:800;
          background:#34d399; color:#062b1c; }
</style>
<div class="tw">
  <h2>Solver benchmark</h2>
  <p class="cap">Zebra rows · gradient header band · right-aligned tabular numerics · highlighted winner</p>
  <table>
    <thead><tr><th>Method</th><th>Matrix</th><th>Size</th><th class="num">Time (s)</th><th class="num">Iters</th></tr></thead>
    <tbody>
      ${tableRows.map(([m, t, s, tm, it, hot]) => `<tr class="${hot ? 'hot' : ''}">
        <td>${m}${hot ? '<span class="best">FASTEST</span>' : ''}</td>
        <td><span class="tag">${t}</span></td>
        <td>${s}</td>
        <td class="num">${tm}</td>
        <td class="num">${it}</td></tr>`).join('\n')}
    </tbody>
  </table>
</div>`, { background: '#0c1119' }));

// ── 5. Inline SVG graph diagram ──────────────────────────────────────────────
// A small directed graph with gradient nodes + arrowhead markers. Pure inline SVG.
slides.push(htmlSlide(`
<style>
  .gw { height:100%; background:radial-gradient(900px 600px at 78% 30%, #12203a, #080c16);
        font-family: system-ui, sans-serif; color:#e5e7eb; display:grid; grid-template-columns:1fr 1.15fr; }
  .gw .txt { align-self:center; padding:0 40px 0 90px; }
  .gw h2 { font-size:56px; font-weight:800; margin:0 0 20px; letter-spacing:-1px; }
  .gw p { font-size:30px; line-height:1.5; color:#94a3b8; max-width:620px; }
  .gw .legend { margin-top:34px; display:flex; flex-direction:column; gap:16px; font-size:26px; }
  .gw .legend div { display:flex; align-items:center; gap:16px; }
  .swatch { width:26px; height:26px; border-radius:50%; }
</style>
<div class="gw">
  <div class="txt">
    <h2>A graph, in inline SVG</h2>
    <p>Nodes are gradient-filled circles; directed edges use a reusable <code>&lt;marker&gt;</code> arrowhead. No image files — the figure is markup, so it stays crisp at any zoom.</p>
    <div class="legend">
      <div><span class="swatch" style="background:linear-gradient(135deg,#f472b6,#db2777)"></span> source</div>
      <div><span class="swatch" style="background:linear-gradient(135deg,#34d399,#059669)"></span> hub (high degree)</div>
      <div><span class="swatch" style="background:linear-gradient(135deg,#60a5fa,#2563eb)"></span> leaf</div>
    </div>
  </div>
  <svg viewBox="0 0 760 760" style="width:100%;height:100%">
    <defs>
      <radialGradient id="src" cx="35%" cy="30%"><stop offset="0" stop-color="#fda4d4"/><stop offset="1" stop-color="#db2777"/></radialGradient>
      <radialGradient id="hub" cx="35%" cy="30%"><stop offset="0" stop-color="#6ee7b7"/><stop offset="1" stop-color="#059669"/></radialGradient>
      <radialGradient id="leaf" cx="35%" cy="30%"><stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#2563eb"/></radialGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#64748b"/>
      </marker>
    </defs>
    <g stroke="#475569" stroke-width="3.5" fill="none" marker-end="url(#arrow)">
      <path d="M170 170 L370 380"/>
      <path d="M600 150 L400 360"/>
      <path d="M150 600 L360 400"/>
      <path d="M610 610 L410 400"/>
      <path d="M385 385 L560 300" stroke="#22d3ee" stroke-width="4"/>
      <path d="M385 385 L230 520" stroke="#22d3ee" stroke-width="4"/>
    </g>
    ${[
      ['170', '170', 'src', 'A', 34],
      ['600', '150', 'src', 'B', 34],
      ['150', '600', 'leaf', 'C', 30],
      ['610', '610', 'leaf', 'D', 30],
      ['560', '300', 'leaf', 'E', 30],
      ['230', '520', 'leaf', 'F', 30],
      ['385', '385', 'hub', 'H', 52],
    ].map(([cx, cy, g, lbl, r]) => `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})" stroke="#0b1220" stroke-width="4"/>
      <text x="${cx}" y="${+cy + 11}" text-anchor="middle" font-size="${+r > 40 ? 40 : 30}" font-weight="800" fill="#0b1220" font-family="system-ui">${lbl}</text>`).join('')}
  </svg>
</div>`, { background: '#080c16' }));

// ── 6. Pure-CSS conic-gradient progress rings (animated fill on load) ─────────
function ring(pct, color, label, val) {
  const deg = Math.round(pct * 3.6);
  return `<div class="ring">
    <div class="dial" style="--deg:${deg}deg; --c:${color}">
      <div class="hole"><span class="pv">${val}</span></div>
    </div>
    <div class="rl">${label}</div>
  </div>`;
}
slides.push(htmlSlide(`
<style>
  @keyframes fill { from { --deg: 0deg; } }
  @property --deg { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  .rw { height:100%; padding:70px 80px; background:#0a0f1c; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:flex; flex-direction:column; }
  .rw h2 { margin:0 0 6px; font-size:52px; font-weight:800; letter-spacing:-1px; }
  .rw .cap { color:#94a3b8; font-size:26px; margin:0 0 30px; }
  .rings { display:grid; grid-template-columns:repeat(4,1fr); gap:30px; flex:1; place-items:center; }
  .ring { display:flex; flex-direction:column; align-items:center; gap:22px; }
  .dial { width:260px; height:260px; border-radius:50%;
          background: conic-gradient(var(--c) var(--deg), rgba(148,163,184,.14) 0);
          display:grid; place-items:center; animation: fill 1.6s ease-out both; }
  .hole { width:196px; height:196px; border-radius:50%; background:#0a0f1c; display:grid; place-items:center; }
  .pv { font-size:58px; font-weight:800; color:#f1f5f9; }
  .rl { font-size:28px; color:#cbd5e1; font-weight:600; }
</style>
<div class="rw">
  <h2>Progress rings</h2>
  <p class="cap">conic-gradient + animated <code>@property --deg</code> — the rings sweep up on load, no JavaScript</p>
  <div class="rings">
    ${ring(87, '#34d399', 'Coverage', '87%')}
    ${ring(64, '#60a5fa', 'Speedup', '6.4×')}
    ${ring(92, '#f472b6', 'Accuracy', '92%')}
    ${ring(78, '#fbbf24', 'Efficiency', '78%')}
  </div>
</div>`, { background: '#0a0f1c' }));

// ── 7. Matrix / heatmap via CSS grid ─────────────────────────────────────────
// A value-colored adjacency-ish matrix. Cells colored by magnitude via HSL.
function heatCell(v) {
  // v in [0,1]; blue(low)->teal->yellow(high)
  const hue = 220 - v * 180; // 220(blue) -> 40(amber)
  const light = 22 + v * 46;
  const txt = v > 0.55 ? '#0b1220' : '#dbeafe';
  return `<div class="cell" style="background:hsl(${hue.toFixed(0)} 85% ${light.toFixed(0)}%); color:${txt}">${v.toFixed(2)}</div>`;
}
const N = 10;
// symmetric-ish matrix with a strong diagonal + a couple of dense blocks
const M = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => {
  if (i === j) return 1;
  const block = (i < 4 && j < 4) || (i >= 6 && j >= 6);
  const base = block ? 0.55 : 0.12;
  const noise = ((Math.sin(i * 3.1 + j * 1.7) + 1) / 2) * 0.4;
  return Math.min(0.98, Math.max(0.03, base + noise * (block ? 0.7 : 0.5)));
}));
slides.push(htmlSlide(`
<style>
  .mw { height:100%; background:#080b14; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:grid; grid-template-columns:1.05fr 1fr; align-items:center; padding:60px 80px; gap:40px; }
  .mw h2 { font-size:54px; font-weight:800; margin:0 0 18px; letter-spacing:-1px; }
  .mw p { font-size:29px; line-height:1.5; color:#94a3b8; max-width:640px; }
  .mw code { font-family: ui-monospace, monospace; background:rgba(148,163,184,.14); padding:2px 8px; border-radius:6px; color:#a5b4fc; }
  .bar { margin-top:30px; height:26px; border-radius:8px; width:440px;
         background:linear-gradient(90deg, hsl(220 85% 30%), hsl(190 85% 40%), hsl(120 80% 40%), hsl(60 85% 50%), hsl(40 85% 55%)); }
  .barlab { display:flex; justify-content:space-between; width:440px; margin-top:8px; font-size:22px; color:#94a3b8; }
  .mat { display:grid; grid-template-columns:repeat(${N},1fr); gap:5px; aspect-ratio:1; padding:14px;
         background:rgba(148,163,184,.06); border:1px solid rgba(148,163,184,.16); border-radius:20px; }
  .cell { display:grid; place-items:center; border-radius:7px; font-size:19px; font-weight:700;
          font-variant-numeric:tabular-nums; }
</style>
<div class="mw">
  <div>
    <h2>Adjacency heatmap</h2>
    <p>A 10×10 matrix laid out as a <code>grid</code>; each cell's color maps its value through an <code>hsl()</code> ramp. Two dense diagonal blocks pop out — the kind of community structure you'd spot in a reordered adjacency matrix.</p>
    <div class="bar"></div>
    <div class="barlab"><span>0.0</span><span>value</span><span>1.0</span></div>
  </div>
  <div class="mat">
    ${M.map((row) => row.map(heatCell).join('')).join('')}
  </div>
</div>`, { background: '#080b14' }));

// ── 8. Timeline / process flow ───────────────────────────────────────────────
function step(n, title, desc, color, done) {
  return `<div class="step">
    <div class="dot" style="--c:${color}">${done ? '✓' : n}</div>
    <div class="stitle">${title}</div>
    <div class="sdesc">${desc}</div>
  </div>`;
}
slides.push(htmlSlide(`
<style>
  .fw { height:100%; padding:80px 90px; background:linear-gradient(160deg,#0d1424,#0a0e1a);
        color:#e5e7eb; font-family: system-ui, sans-serif; display:flex; flex-direction:column; }
  .fw h2 { margin:0 0 8px; font-size:54px; font-weight:800; letter-spacing:-1px; }
  .fw .cap { color:#94a3b8; font-size:27px; margin:0 0 70px; }
  .flow { display:grid; grid-template-columns:repeat(5,1fr); position:relative; }
  .flow::before { content:""; position:absolute; top:44px; left:9%; right:9%; height:5px;
                  background:linear-gradient(90deg,#34d399,#22d3ee,#818cf8,#c084fc,#f472b6); border-radius:3px; }
  .step { display:flex; flex-direction:column; align-items:center; text-align:center; padding:0 18px; position:relative; }
  .dot { width:88px; height:88px; border-radius:50%; display:grid; place-items:center; font-size:40px; font-weight:800;
         color:#0b1220; background:var(--c); box-shadow:0 0 0 10px #0a0e1a, 0 12px 30px rgba(0,0,0,.5); z-index:1; }
  .stitle { margin-top:30px; font-size:30px; font-weight:700; }
  .sdesc { margin-top:12px; font-size:23px; color:#94a3b8; line-height:1.4; }
</style>
<div class="fw">
  <h2>Pipeline, step by step</h2>
  <p class="cap">A connected process flow — the track is a single gradient bar behind the nodes</p>
  <div class="flow">
    ${step(1, 'Partition', 'METIS reorder', '#34d399', true)}
    ${step(2, 'Assemble', 'sparse system', '#22d3ee', true)}
    ${step(3, 'Precondition', 'AMG hierarchy', '#818cf8', false)}
    ${step(4, 'Solve', 'PCG to 1e-9', '#c084fc', false)}
    ${step(5, 'Visualize', 'export deck', '#f472b6', false)}
  </div>
</div>`, { background: '#0a0e1a' }));

// ── 9. Callout cards + pills + faux-syntax code block ────────────────────────
slides.push(htmlSlide(`
<style>
  .cw { height:100%; padding:64px 80px; background:#0b1020; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:grid; grid-template-columns:1fr 1.05fr; grid-template-rows:auto 1fr; column-gap:56px;
        align-items:center; }
  .cw h2 { grid-column:1/-1; margin:0 0 14px; font-size:52px; font-weight:800; letter-spacing:-1px; }
  .cards { display:flex; flex-direction:column; gap:22px; }
  .callout { border-radius:18px; padding:26px 30px; display:flex; gap:20px; align-items:flex-start;
             border:1px solid; background:rgba(255,255,255,.03); }
  .callout .ico { font-size:38px; line-height:1; }
  .callout .ct { font-size:30px; font-weight:700; margin:0 0 6px; }
  .callout .cd { font-size:24px; color:#cbd5e1; margin:0; line-height:1.4; }
  .info { border-color:rgba(96,165,250,.5); } .info .ct{color:#93c5fd}
  .ok   { border-color:rgba(52,211,153,.5); } .ok .ct{color:#6ee7b7}
  .warn { border-color:rgba(251,191,36,.5); } .warn .ct{color:#fcd34d}
  .pills { display:flex; flex-wrap:wrap; gap:12px; margin-top:6px; }
  .pill { padding:8px 18px; border-radius:999px; font-size:22px; font-weight:600; }
  .code { background:#0f1729; border:1px solid rgba(148,163,184,.2); border-radius:18px; padding:34px 38px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size:26px; line-height:1.7; }
  .code .k{color:#c084fc} .code .s{color:#6ee7b7} .code .n{color:#fbbf24} .code .c{color:#64748b} .code .f{color:#60a5fa} .code .p{color:#f472b6}
  .code .row{white-space:pre}
</style>
<div class="cw">
  <h2>Callouts, pills &amp; code</h2>
  <div class="cards">
    <div class="callout info"><div class="ico">💡</div><div><p class="ct">Note</p><p class="cd">The element is a general escape hatch for custom layout.</p></div></div>
    <div class="callout ok"><div class="ico">✅</div><div><p class="ct">Safe by construction</p><p class="cd">No script executes; the browser enforces the sandbox.</p></div></div>
    <div class="callout warn"><div class="ico">⚠️</div><div><p class="ct">Offline only</p><p class="cd">Remote URLs are CSP-blocked — embed media as data: URIs.</p></div></div>
    <div class="pills">
      <span class="pill" style="background:rgba(96,165,250,.16);color:#93c5fd">flexbox</span>
      <span class="pill" style="background:rgba(52,211,153,.16);color:#6ee7b7">grid</span>
      <span class="pill" style="background:rgba(244,114,182,.16);color:#f9a8d4">inline&nbsp;svg</span>
      <span class="pill" style="background:rgba(192,132,252,.16);color:#d8b4fe">@keyframes</span>
      <span class="pill" style="background:rgba(251,191,36,.16);color:#fcd34d">data:&nbsp;URI</span>
    </div>
  </div>
  <div class="code">
<div class="row"><span class="c"># faux-syntax — colored spans, monospace stack</span></div>
<div class="row"><span class="k">for</span> k <span class="k">in</span> <span class="f">range</span>(<span class="n">max_iter</span>):</div>
<div class="row">    r  = b <span class="p">-</span> A <span class="p">@</span> x</div>
<div class="row">    z  = <span class="f">M_solve</span>(r)          <span class="c"># precondition</span></div>
<div class="row">    <span class="k">if</span> <span class="f">norm</span>(r) <span class="p">&lt;</span> <span class="n">1e-9</span>: <span class="k">break</span></div>
<div class="row">    x <span class="p">+=</span> alpha <span class="p">*</span> p</div>
<div class="row"><span class="k">return</span> x, <span class="s">"converged"</span></div>
  </div>
</div>`, { background: '#0b1020' }));

// ── 10. data: URI media demo ─────────────────────────────────────────────────
// Prove offline-embeddable images: a tiny data: PNG (a 2x2 gradient, upscaled
// pixelated) + a data: SVG image, side by side, next to the same drawn inline.
const PNG_2x2 = // 2x2 magenta/cyan/amber/violet PNG, base64 (generated below at build)
  makePng2x2();
const SVG_DATA = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="100" height="100" rx="18" fill="url(#g)"/><circle cx="50" cy="50" r="26" fill="#fff" opacity=".85"/><path d="M38 50 l9 9 l17 -19" stroke="#0ea5e9" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
).toString('base64');
slides.push(htmlSlide(`
<style>
  .dw { height:100%; padding:70px 90px; background:#0c1018; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:flex; flex-direction:column; }
  .dw h2 { margin:0 0 6px; font-size:52px; font-weight:800; letter-spacing:-1px; }
  .dw .cap { color:#94a3b8; font-size:27px; margin:0 0 44px; max-width:1300px; line-height:1.4; }
  .row { display:grid; grid-template-columns:repeat(3,1fr); gap:44px; flex:1; }
  .tile { background:rgba(148,163,184,.06); border:1px solid rgba(148,163,184,.16); border-radius:22px;
          padding:36px; display:flex; flex-direction:column; align-items:center; gap:26px; justify-content:center; }
  .tile img, .tile svg { width:230px; height:230px; border-radius:20px; }
  .px { image-rendering:pixelated; }
  .tt { font-size:26px; font-weight:700; text-align:center; }
  .td { font-size:22px; color:#94a3b8; text-align:center; }
  .mono { font-family: ui-monospace, monospace; color:#a5b4fc; }
</style>
<div class="dw">
  <h2>Offline-embeddable media</h2>
  <p class="cap">All three tiles are self-contained — no file on disk, no network. A tiny base64 PNG, a base64 SVG image, and the same figure drawn as inline <span class="mono">&lt;svg&gt;</span>.</p>
  <div class="row">
    <div class="tile">
      <img class="px" src="${PNG_2x2}" alt="tiny png upscaled">
      <div><div class="tt">data: PNG</div><div class="td">2×2 px, upscaled pixelated</div></div>
    </div>
    <div class="tile">
      <img src="${SVG_DATA}" alt="svg data uri">
      <div><div class="tt">data: SVG image</div><div class="td">base64 in an &lt;img&gt;</div></div>
    </div>
    <div class="tile">
      <svg viewBox="0 0 100 100"><defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs><rect width="100" height="100" rx="18" fill="url(#ig)"/><circle cx="50" cy="50" r="26" fill="#0c1018"/><text x="50" y="62" text-anchor="middle" font-size="34" font-weight="800" fill="#e5e7eb" font-family="system-ui">λ</text></svg>
      <div><div class="tt">inline SVG</div><div class="td">markup, infinitely crisp</div></div>
    </div>
  </div>
</div>`, { background: '#0c1018' }));

// ── 11. Animation showpiece — convergence bars + pulsing node + shimmer ───────
function convBar(label, pct, color, delay) {
  return `<div class="cb">
    <div class="cbl">${label}</div>
    <div class="cbt"><div class="cbf" style="--w:${pct}%; --c:${color}; animation-delay:${delay}s"></div></div>
  </div>`;
}
slides.push(htmlSlide(`
<style>
  @keyframes grow { from { width:0; } to { width:var(--w); } }
  @keyframes pulse { 0%,100%{ transform:scale(1); opacity:1;} 50%{ transform:scale(1.35); opacity:.55;} }
  @keyframes wave { 0%,100%{ transform:scaleY(.35);} 50%{ transform:scaleY(1);} }
  @keyframes shimmer { to { background-position: 200% 0; } }
  .aw { height:100%; padding:64px 84px; background:#080b14; color:#e5e7eb; font-family: system-ui, sans-serif;
        display:grid; grid-template-columns:1.25fr 1fr; grid-template-rows:auto auto 1fr;
        column-gap:56px; row-gap:8px; align-items:center; }
  .aw h2 { grid-column:1/-1; margin:0; font-size:54px; font-weight:800; letter-spacing:-1px; }
  .aw .cap { grid-column:1/-1; color:#94a3b8; font-size:26px; margin:0 0 20px; }
  .bars { display:flex; flex-direction:column; gap:28px; }
  .cb { display:grid; grid-template-columns:220px 1fr; align-items:center; gap:24px; }
  .cbl { font-size:28px; font-weight:600; color:#cbd5e1; }
  .cbt { height:44px; border-radius:12px; background:rgba(148,163,184,.12); overflow:hidden; }
  .cbf { height:100%; border-radius:12px; background:linear-gradient(90deg,var(--c),#fff3);
         animation: grow 1.8s cubic-bezier(.22,1,.36,1) both; }
  .right { display:flex; flex-direction:column; align-items:center; gap:56px; }
  .node { width:150px; height:150px; border-radius:50%;
          background:radial-gradient(circle at 35% 30%,#a5f3fc,#0ea5e9); animation: pulse 1.8s ease-in-out infinite;
          box-shadow:0 0 60px rgba(14,165,233,.6); }
  .eq { display:flex; align-items:flex-end; gap:12px; height:150px; }
  .eq i { display:block; width:22px; height:100%; border-radius:8px 8px 0 0; transform-origin:bottom;
          background:linear-gradient(180deg,#f472b6,#a855f7); animation: wave 1.1s ease-in-out infinite; }
  .eq i:nth-child(2){animation-delay:.15s} .eq i:nth-child(3){animation-delay:.3s}
  .eq i:nth-child(4){animation-delay:.45s} .eq i:nth-child(5){animation-delay:.6s} .eq i:nth-child(6){animation-delay:.75s}
  .load { width:320px; height:18px; border-radius:999px; overflow:hidden;
          background:linear-gradient(90deg,#1e293b 25%,#334155 37%,#1e293b 63%); background-size:200% 100%;
          animation: shimmer 1.4s linear infinite; }
</style>
<div class="aw">
  <h2>Script-less, still dynamic</h2>
  <p class="cap">Everything on this slide moves — driven entirely by CSS <code>@keyframes</code>. Captured mid-animation below.</p>
  <div class="bars">
    ${convBar('Jacobi', '96', '#ef4444', 0)}
    ${convBar('Gauss–Seidel', '82', '#f59e0b', 0.15)}
    ${convBar('SOR', '61', '#eab308', 0.3)}
    ${convBar('Multigrid', '18', '#34d399', 0.45)}
  </div>
  <div class="right">
    <div class="node"></div>
    <div class="eq"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="load"></div>
  </div>
</div>`, { background: '#080b14' }));

// ── 12. Closing — restate the value ──────────────────────────────────────────
slides.push(htmlSlide(`
<style>
  @keyframes drift { from{background-position:0 0} to{background-position:120px 120px} }
  .end { position:relative; height:100%; overflow:hidden; font-family: system-ui, sans-serif; color:#e5e7eb;
         background:#070a16; display:grid; place-items:center; }
  .end .mesh { position:absolute; inset:-40px;
    background-image: radial-gradient(rgba(99,102,241,.18) 2px, transparent 2px), radial-gradient(rgba(236,72,153,.14) 2px, transparent 2px);
    background-size:60px 60px, 60px 60px; background-position:0 0, 30px 30px; animation: drift 12s linear infinite; }
  .end .inner { position:relative; text-align:center; max-width:1400px; padding:0 60px; }
  .end h1 { margin:0 0 40px; font-size:96px; font-weight:800; letter-spacing:-3px; line-height:1.05;
    background:linear-gradient(100deg,#c7d2fe,#f5d0fe,#a7f3d0); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .props { display:flex; justify-content:center; gap:22px; flex-wrap:wrap; }
  .prop { padding:20px 32px; border-radius:16px; font-size:30px; font-weight:700; display:flex; gap:14px; align-items:center;
    background:rgba(255,255,255,.04); border:1px solid rgba(148,163,184,.22); }
  .prop .e { font-size:36px; }
  .foot { margin-top:46px; font-size:26px; color:#94a3b8; }
</style>
<div class="end">
  <div class="mesh"></div>
  <div class="inner">
    <h1>One element,<br>a whole design system</h1>
    <div class="props">
      <div class="prop"><span class="e">🔒</span> sandboxed</div>
      <div class="prop"><span class="e">🚫</span> no&nbsp;script</div>
      <div class="prop"><span class="e">📡</span> no&nbsp;network</div>
      <div class="prop"><span class="e">🤖</span> LLM-authorable</div>
    </div>
    <p class="foot">Write markup · it renders live in present mode and in the exported HTML</p>
  </div>
</div>`, { background: '#070a16' }));

// ── helper: build a tiny valid 2x2 PNG data URI (no deps) ────────────────────
function makePng2x2() {
  const px = [ // RGBA, 4 pixels
    [244, 114, 182, 255], [34, 211, 238, 255],
    [251, 191, 36, 255], [168, 85, 247, 255],
  ];
  const W = 2, H = 2;
  const raw = Buffer.alloc(H * (1 + W * 4));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filter none
    for (let x = 0; x < W; x++) { const p = px[y * W + x]; raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3]; }
  }
  const comp = zlib.deflateSync(raw);
  const crc = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

// ── emit deck ────────────────────────────────────────────────────────────────
const deck = {
  title: 'HTML Element Showcase',
  theme: 'black',
  config: { width: 1920, height: 1080, defaultBodyFont: 'ptSans' },
  slides,
};
process.stdout.write(JSON.stringify(deck, null, 2));
