// Present mode fully unmounts the editor; on Escape the floating insert HUD remounts
// fresh. The --insert-hud-h var (canvas top-padding = HUD height) is set by an effect
// that must RE-RUN on that remount — otherwise the new HUD goes unmeasured, the canvas
// falls back to a short padding, and the +Title/+Body chips overlap the slide (worst
// with the inspector open, which wraps the chips to extra rows). Asserts --insert-hud-h
// still matches the real HUD height after an inspector-on present→escape cycle.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('HUD_FAIL:', m); process.exit(1); };
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 25; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
// Read the HUD's measured height and the --insert-hud-h var currently applied.
const readHud = (sid) => exec(sid, `
  const hud = document.querySelector('.editor-area .editor-actions');
  const area = document.querySelector('.editor-area');
  if (!hud || !area) return { err: 'no HUD/editor-area' };
  return { measured: hud.offsetTop + hud.offsetHeight, cssVar: getComputedStyle(area).getPropertyValue('--insert-hud-h').trim() };
`);

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// Inspector on (matches the repro; also narrows the editor so the HUD is real height).
await exec(sid, "var s=window.__eigendeck.store.getState(); if(!s.showProperties) s.toggleProperties();");
if (!await waitFor(sid, "!!document.querySelector('.editor-area .editor-actions')")) fail('no HUD after open');
await sleep(300);

const before = await readHud(sid);
if (before.err) fail(before.err);
if (before.cssVar !== `${before.measured}px`) problems.push(`baseline: --insert-hud-h '${before.cssVar}' != measured ${before.measured}px`);

// Present, wait for the editor to unmount, then Escape back and wait for it to remount.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
if (!await waitFor(sid, "!!document.querySelector('.present-slide, .present-mode')")) fail('present did not mount');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
if (!await waitFor(sid, "!!document.querySelector('.editor-area .editor-actions')")) fail('editor did not remount after escape');
await sleep(400);

const after = await readHud(sid);
if (after.err) fail(after.err);
if (!after.cssVar) problems.push(`after present→escape: --insert-hud-h is UNSET → canvas uses fallback padding, HUD overlaps the slide`);
else if (after.cssVar !== `${after.measured}px`) problems.push(`after present→escape: --insert-hud-h '${after.cssVar}' != re-measured ${after.measured}px`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HUD_PASS: insert-HUD padding re-measured after present→escape (${after.cssVar}); chips clear the slide`);
process.exit(0);
