// #137 regression: a deck built WITHOUT a `config` block must still present. The
// present stage reads presentation.config.width; when absent it fell back to
// undefined → the .present-slide stage collapsed to 0×0 and every element
// overflowed off-screen (present showed nothing). PresentMode now defaults to
// 1920×1080. This probe opens a config-less full-bleed html deck, enters present,
// and asserts the stage is scaled to fit (not 0×0) with the element on-screen.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('PRESENT_STAGE_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
await sleep(1000);
await exec(sid, "const s=window.__eigendeck.store.getState(); s.selectSlide(0); s.setPresenting(true);");
await sleep(1600);
const g = JSON.parse(await exec(sid, `
  const vw=window.innerWidth, vh=window.innerHeight;
  const slide=document.querySelector('.present-slide');
  const frame=document.querySelector('.present-slide iframe[title="HTML element"]');
  const r=e=>{const b=e.getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)}};
  const center=document.elementFromPoint(vw/2,vh/2);
  return JSON.stringify({ vw, vh, slide: slide?r(slide):null, frame: frame?r(frame):null,
    centerInSlide: !!(center && center.closest('.present-slide')) });
`));
const problems = [];
if (!g.slide || g.slide.w < 200 || g.slide.h < 200) problems.push(`present stage collapsed: ${JSON.stringify(g.slide)} (config-less deck should default to 1920×1080 scaled)`);
if (!g.frame || g.frame.w < 200) problems.push(`html iframe not laid out: ${JSON.stringify(g.frame)}`);
if (g.frame && g.frame.w > g.vw + 4) problems.push(`iframe overflows the viewport (unscaled): frame.w=${g.frame.w} > vw=${g.vw}`);
if (!g.centerInSlide) problems.push('nothing painted at screen center (content off-screen)');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`PRESENT_STAGE_PASS: config-less deck presents — stage ${g.slide.w}×${g.slide.h} scaled to fit ${g.vw}×${g.vh}, element on-screen.`);
process.exit(0);
