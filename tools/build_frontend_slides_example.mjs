// Reproducible builder for examples/frontend-slides.eigendeck — a bold, self-
// contained "frontend-slides"-style deck authored entirely with Eigendeck `html`
// elements (one full-bleed element per slide, 1920×1080). Dogfoods the
// `frontend-slides-eigendeck` skill's patterns: no <script>, no network — CSS
// gradients / SVG / @keyframes, system font stacks. A meta talk about the element.
//
//   node tools/build_frontend_slides_example.mjs           # → /tmp .json + import via CLI
//   E2E_CLI=/path/to/eigendeck-cli node tools/build_frontend_slides_example.mjs
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANS = "system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Iowan Old Style','Palatino Linotype',Georgia,serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Code',Menlo,monospace";
const KF = '@keyframes rise{to{opacity:1;transform:none}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes drift{to{transform:translate(40px,-30px) scale(1.08)}}';

const htmlEl = (id, html) => ({ id, type: 'html', background: '#0a0a0f',
  position: { x: 0, y: 0, width: 1920, height: 1080 }, html: html.trim() });

const hero = htmlEl('hero', `
<style>:root{--accent:#7c3aed;--accent2:#ec4899;--muted:#94a3b8}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:radial-gradient(circle at 18% 20%,#211b4e,transparent 55%),#0a0a0f;color:#fff;font-family:${SANS};display:flex;flex-direction:column;justify-content:center;padding:130px;position:relative;overflow:hidden}
.aurora{position:absolute;inset:-45%;background:conic-gradient(from 0deg,var(--accent),var(--accent2),#38bdf8,var(--accent));filter:blur(130px);opacity:.4;animation:spin 20s linear infinite}
.kicker{font-size:28px;letter-spacing:.32em;text-transform:uppercase;color:var(--accent2);font-weight:700;position:relative;opacity:0;transform:translateY(28px);animation:rise .8s .1s forwards}
.dot{display:inline-block;width:16px;height:16px;border-radius:50%;background:var(--accent2);box-shadow:0 0 24px var(--accent2);margin-right:16px;vertical-align:middle}
h1{font-size:158px;line-height:.94;font-weight:800;letter-spacing:-.03em;position:relative;background:linear-gradient(120deg,#fff 30%,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent;opacity:0;transform:translateY(28px);animation:rise .9s .25s forwards}
p{font-size:34px;line-height:1.4;color:var(--muted);max-width:66%;margin-top:34px;position:relative;opacity:0;transform:translateY(28px);animation:rise .9s .4s forwards}
${KF}</style>
<div class="slide"><div class="aurora"></div>
<div class="kicker"><span class="dot"></span>Frontend-slides, in Eigendeck</div>
<h1>Design that<br>ships itself.</h1>
<p>Bold, self-contained slides authored as sandboxed HTML — gradients, SVG, and CSS motion, with no framework and no script.</p></div>`);

const section = htmlEl('section', `
<style>:root{--accent:#7c3aed}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:#0a0a0f;color:#fff;font-family:${SANS};display:flex;align-items:center;gap:60px;padding:130px;overflow:hidden}
.num{font-size:340px;font-weight:800;line-height:1;letter-spacing:-.04em;background:linear-gradient(160deg,var(--accent),#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent;opacity:.95}
.t{font-size:100px;font-weight:800;letter-spacing:-.02em}
.t small{display:block;font-size:30px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#64748b;margin-bottom:18px}</style>
<div class="slide"><div class="num">01</div><div class="t"><small>The idea</small>One element,<br>one canvas.</div></div>`);

const stats = htmlEl('stats', `
<style>:root{--accent:#22d3ee;--muted:#94a3b8}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:#0a0a0f;color:#fff;font-family:${SANS};display:flex;flex-direction:column;justify-content:center;padding:120px;gap:56px}
h2{font-size:84px;font-weight:800;letter-spacing:-.02em}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:36px}
.card{background:linear-gradient(160deg,#141420,#0d0d16);border:1px solid #24243a;border-radius:28px;padding:48px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--accent),transparent)}
.stat{font-size:96px;font-weight:800;letter-spacing:-.03em;background:linear-gradient(120deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.lab{font-size:26px;color:var(--muted);margin-top:10px}</style>
<div class="slide"><h2>What the sandbox buys you</h2><div class="grid">
<div class="card"><div class="stat">0</div><div class="lab">scripts run — nothing to trust</div></div>
<div class="card"><div class="stat">0</div><div class="lab">network requests — data: only</div></div>
<div class="card"><div class="stat">1</div><div class="lab">file — travels with the deck</div></div></div></div>`);

const quote = htmlEl('quote', `
<style>:root{--accent:#f472b6}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:radial-gradient(circle at 80% 15%,#2a1030,transparent 50%),#0a0a0f;color:#fff;font-family:${SERIF};display:flex;flex-direction:column;justify-content:center;padding:160px;position:relative}
.mark{font-size:280px;line-height:.6;color:var(--accent);opacity:.35;font-family:Georgia,serif}
blockquote{font-size:64px;line-height:1.25;font-weight:500;max-width:82%;margin-top:-40px}
.by{font-family:${SANS};font-size:28px;color:#94a3b8;margin-top:44px;letter-spacing:.04em}</style>
<div class="slide"><div class="mark">&ldquo;</div><blockquote>Dependencies are debt. A single HTML file will still work in ten years.</blockquote><div class="by">— the self-contained principle</div></div>`);

const table = htmlEl('table', `
<style>:root{--accent:#34d399}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:#0a0a0f;color:#e5e7eb;font-family:${SANS};display:flex;flex-direction:column;justify-content:center;padding:120px;gap:44px}
h2{font-size:80px;font-weight:800;letter-spacing:-.02em;color:#fff}
table{width:100%;border-collapse:collapse;font-size:30px}
thead th{text-align:left;padding:24px 28px;background:linear-gradient(90deg,#12241d,#0d0d16);color:#fff;font-size:24px;letter-spacing:.12em;text-transform:uppercase}
td{padding:24px 28px;border-top:1px solid #1f2937}
tbody tr:nth-child(even){background:#0e0e18}
.win{color:var(--accent);font-weight:700}
td:not(:first-child){text-align:center;font-variant-numeric:tabular-nums;font-family:${MONO}}</style>
<div class="slide"><h2>Where it lands vs. plain HTML slides</h2><table>
<thead><tr><th>Capability</th><th>Static HTML</th><th>This element</th></tr></thead>
<tbody>
<tr><td>Gradients · inline SVG · @keyframes</td><td class="win">&#10003;</td><td class="win">&#10003;</td></tr>
<tr><td>Native controls · :hover · :checked</td><td class="win">&#10003;</td><td class="win">&#10003;</td></tr>
<tr><td>Runs JavaScript</td><td class="win">&#10003;</td><td>&mdash; by design</td></tr>
<tr><td>Remote fonts / images</td><td class="win">&#10003;</td><td>data: only</td></tr>
<tr><td>Contained &amp; safe to share</td><td>&mdash;</td><td class="win">&#10003; sandboxed</td></tr>
</tbody></table></div>`);

const closing = htmlEl('closing', `
<style>:root{--accent:#7c3aed;--accent2:#ec4899}*{margin:0;box-sizing:border-box}
.slide{height:100%;background:#0a0a0f;color:#fff;font-family:${SANS};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;position:relative;overflow:hidden}
.mesh{position:absolute;inset:0;background:radial-gradient(circle at 20% 30%,rgba(124,58,237,.28),transparent 40%),radial-gradient(circle at 80% 70%,rgba(236,72,153,.28),transparent 40%);animation:drift 16s ease-in-out infinite alternate}
h1{font-size:130px;font-weight:800;letter-spacing:-.03em;position:relative;background:linear-gradient(120deg,#fff,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent}
.badges{display:flex;gap:18px;position:relative}
.b{padding:14px 30px;border:1px solid #2b2b44;border-radius:999px;font-size:24px;color:#cbd5e1}
${KF}</style>
<div class="slide"><div class="mesh"></div><h1>Go wild. Safely.</h1>
<div class="badges"><span class="b">sandboxed</span><span class="b">no script</span><span class="b">no network</span><span class="b">LLM-authorable</span></div></div>`);

const mk = (id, theme, el) => ({ id, layout: 'default', notes: '', theme, elements: [el] });
const deck = {
  title: 'Frontend-slides in Eigendeck',
  theme: 'black',
  config: { width: 1920, height: 1080 },
  slides: [
    mk('s0', 'black', hero), mk('s1', 'black', section), mk('s2', 'black', stats),
    mk('s3', 'black', quote), mk('s4', 'black', table), mk('s5', 'black', closing),
  ],
};

const jsonPath = join(tmpdir(), 'frontend-slides.json');
writeFileSync(jsonPath, JSON.stringify(deck, null, 2));
const deckPath = new URL('../examples/frontend-slides.eigendeck', import.meta.url).pathname;
const cli = process.env.E2E_CLI
  || ['/tmp/el-target/debug/eigendeck-cli', '/work/src-tauri/target/debug/eigendeck-cli'].find((p) => {
    try { execFileSync(p, ['--help'], { stdio: 'ignore' }); return true; } catch { return false; }
  });
if (!cli) { console.error('No eigendeck-cli found — set E2E_CLI'); process.exit(1); }
try { execFileSync('rm', ['-f', deckPath, `${deckPath}-wal`, `${deckPath}-shm`]); } catch { /* fresh */ }
execFileSync(cli, [deckPath, 'import', 'json', jsonPath], { stdio: 'inherit' });
console.log(`built ${deckPath} (${deck.slides.length} slides)`);
