// Renders slides of examples/html-showcase.eigendeck through the real app and
// screenshots each, so we can eyeball that every html-element slide looks good.
// Robust to a WebKit compositing crash: it opens a session, walks slides from
// START..END capturing each, and if the driver connection drops it re-opens a
// session and resumes at the next uncaptured slide. Set E2E_START/E2E_END (1-based)
// to render a sub-range.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-showcase-e2e';
const START = parseInt(process.env.E2E_START || '1', 10);
const END = process.env.E2E_END ? parseInt(process.env.E2E_END, 10) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 30; i++) { await sleep(800); try { if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } catch { /* retry */ } } return false; }
async function winShot(sid, name) { const r = await fetch(`${BASE}/session/${sid}/screenshot`); const j = await r.json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); return true; } return false; }
const fail = (m) => { console.error('SHOWCASE_FAIL:', m); process.exit(1); };
const name = (i) => `slide-${String(i + 1).padStart(2, '0')}`;

mkdirSync(OUT, { recursive: true });
let n = END; // if END set, we know the max; else discover from first session
const problems = [];
const captured = new Set();

async function session(fromIdx) {
  const sid = await open(); if (!sid) return { crashed: true, next: fromIdx };
  if (!await waitSeam(sid)) { await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {}); return { crashed: true, next: fromIdx }; }
  await sleep(1000);
  try {
    const total = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
    if (typeof total === 'number') n = n ? Math.min(n, total) : total;
    await exec(sid, "const s=window.__eigendeck.store.getState(); if(s.showProperties) s.toggleProperties();");
    await sleep(300);
    for (let i = fromIdx; i < n; i++) {
      await exec(sid, `window.__eigendeck.store.getState().selectSlide(${i}); window.__eigendeck.store.getState().selectObject(null);`);
      await sleep(1600);
      const ok = await exec(sid, `
        const f = document.querySelector('.el-html iframe');
        if (!f) return 'NO_IFRAME';
        try { const b = f.contentDocument && f.contentDocument.body; return b && b.innerHTML.length > 20 ? 'OK' : 'EMPTY'; } catch (e) { return 'THREW'; }
      `);
      if (ok !== 'OK') problems.push(`slide ${i + 1}: iframe ${ok}`);
      if (await winShot(sid, name(i))) { captured.add(i); console.log(`  ${name(i)}: ${ok}`); }
      else problems.push(`slide ${i + 1}: screenshot failed`);
    }
    await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
    return { crashed: false, next: n };
  } catch (e) {
    await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
    // find first uncaptured >= START to resume from
    let next = fromIdx;
    while (captured.has(next)) next++;
    console.log(`  (driver dropped: ${String(e).split('\n')[0]}) resume @ slide ${next + 1}`);
    return { crashed: true, next };
  }
}

let from = START - 1;
for (let attempt = 0; attempt < 20; attempt++) {
  if (n != null && from >= n) break;
  const { crashed, next } = await session(from);
  from = next;
  // advance past any already-captured
  while (captured.has(from)) from++;
  if (!crashed && n != null && from >= n) break;
  if (n == null && !crashed) break; // couldn't discover count but didn't crash
  await sleep(1500);
}

const missing = [];
for (let i = START - 1; i < (n || 0); i++) if (!existsSync(`${OUT}/${name(i)}.png`)) missing.push(i + 1);
if (missing.length) problems.push(`slides never captured: ${missing.join(',')}`);
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`SHOWCASE_PASS: slides ${START}..${n} rendered; PNGs → ${OUT}/`);
process.exit(0);
