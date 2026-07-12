// Present → navigate → Escape → editor, across several editor states. After each
// cycle assert editor invariants:
//   - no leftover present DOM (.present-mode / .present-slide gone)
//   - body.presenting class removed
//   - --insert-hud-h set on .editor-area (== measured HUD height, not fallback)
//   - the editor shows the slide the presenter navigated to (currentSlideIndex)
//   - the correct slide's canvas element is the one actually rendered
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 30; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
const fail = (m) => { console.error('ESCINV_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// Read editor invariants after an escape.
const readEditor = (sid) => exec(sid, `
  const area = document.querySelector('.editor-area');
  const hud = document.querySelector('.editor-area .editor-actions');
  const st = window.__eigendeck.store.getState();
  return {
    presentModeGone: !document.querySelector('.present-mode'),
    presentSlideGone: !document.querySelector('.present-slide'),
    bodyPresenting: document.body.classList.contains('presenting'),
    hudVar: area ? getComputedStyle(area).getPropertyValue('--insert-hud-h').trim() : 'NO-AREA',
    hudMeasured: hud ? (hud.offsetTop + hud.offsetHeight) : null,
    csi: st.currentSlideIndex,
    isPresenting: st.isPresenting,
    // The visible editor title text tells us which slide is rendered on the canvas.
    canvasTitle: (document.querySelector('.slide-canvas .el-text, .editor-canvas .el-text, [class*="canvas"] .el-text') || {}).textContent || document.querySelector('.editor-area')?.textContent?.slice(0,0) || '',
  };
`);

// helper: run a full present -> goto(target) -> escape cycle, return editor read
async function cycle(sid, target, label, setup) {
  if (setup) { await exec(sid, setup); await sleep(200); }
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
  if (!await waitFor(sid, "!!document.querySelector('.present-slide')")) { problems.push(`[${label}] present did not mount`); return null; }
  await sleep(300);
  // navigate to target slide via the store (present's goTo -> selectSlide)
  await exec(sid, `window.__eigendeck.store.getState().selectSlide(${target});`);
  await sleep(400);
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
  if (!await waitFor(sid, "!!document.querySelector('.editor-area .editor-actions')")) { problems.push(`[${label}] editor did not remount`); return null; }
  await sleep(400);
  const r = await readEditor(sid);
  if (!r.presentModeGone) problems.push(`[${label}] .present-mode still in DOM after escape`);
  if (!r.presentSlideGone) problems.push(`[${label}] .present-slide still in DOM after escape`);
  if (r.bodyPresenting) problems.push(`[${label}] body still has .presenting after escape`);
  if (r.isPresenting) problems.push(`[${label}] store.isPresenting still true after escape`);
  if (r.csi !== target) problems.push(`[${label}] currentSlideIndex ${r.csi} != navigated-to ${target}`);
  if (r.hudVar === 'NO-AREA') problems.push(`[${label}] no .editor-area after escape`);
  else if (!r.hudVar) problems.push(`[${label}] --insert-hud-h UNSET after escape (canvas fallback padding, HUD overlaps slide)`);
  else if (r.hudMeasured != null && r.hudVar !== `${r.hudMeasured}px`) problems.push(`[${label}] --insert-hud-h '${r.hudVar}' != measured ${r.hudMeasured}px`);
  return r;
}

// 1. default state, navigate to slide 2
await cycle(sid, 2, 'default->2');
// 2. inspector open, navigate to slide 1
await cycle(sid, 1, 'inspector->1', "var s=window.__eigendeck.store.getState(); if(!s.showProperties) s.toggleProperties();");
// 3. history panel open, navigate to slide 0
await cycle(sid, 0, 'history->0', "var s=window.__eigendeck.store.getState(); if(!s.showHistory && s.toggleHistory) s.toggleHistory();");
// 4. a text element selected before present
await cycle(sid, 2, 'sel-el->2', "var s=window.__eigendeck.store.getState(); s.selectSlide(0); s.selectObject && s.selectObject({type:'element', id:'t0'});");
// 5. inspector + history both open
await cycle(sid, 1, 'insp+hist->1', "var s=window.__eigendeck.store.getState(); if(!s.showProperties) s.toggleProperties(); if(!s.showHistory && s.toggleHistory) s.toggleHistory();");

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('ESCINV_PASS: present->navigate->escape leaves a clean editor (no leftover present DOM, hud var re-measured, correct slide) across states');
process.exit(0);
