// Screen-share / speaker present leaves App-local `multiMonitorPresenting` stale.
// End Presentation in SpeakerMode calls closePresenterWindow()+setPresenting(false),
// but in skipWindow (screen-share) mode there is NO presenter window, so the
// `presenter:closed` event that resets multiMonitorPresenting NEVER fires. The flag
// stays true. The NEXT plain single-window present (setPresenting(true), the path
// the seam + a projector-disabled Present button use) then renders SpeakerMode
// instead of the live slide, because App gates: isPresenting && multiMonitorPresenting.
//
// Repro: drive the REAL screen-share path (eigendeck:screen-share-present skipWindow),
// confirm SpeakerMode, exit via setPresenting(false) (== End Presentation), then enter
// present again via setPresenting(true) and assert we get the LIVE SLIDE, not speaker.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 30; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
const fail = (m) => { console.error('STALEFLAG_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// 1. Enter screen-share present (real path, no projector window). App sets
//    multiMonitorPresenting=true and renders SpeakerMode.
await exec(sid, "window.dispatchEvent(new CustomEvent('eigendeck:screen-share-present',{detail:{skipWindow:true}}));");
if (!await waitFor(sid, "!!document.querySelector('.speaker-mode')")) fail('SpeakerMode did not mount from screen-share present (path changed?)');
await sleep(300);

// 2. End Presentation == closePresenterWindow() + setPresenting(false). With no
//    presenter window, presenter:closed never fires. We invoke the same store call
//    the button does. (We can also click the real button; both call setPresenting(false).)
const clicked = await exec(sid, `const b=[...document.querySelectorAll('.speaker-exit,button')].find(x=>/End Presentation/.test(x.textContent)); if(b){b.click();return true;} return false;`);
if (!clicked) { // fallback to the exact store call the handler makes
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
}
if (!await waitFor(sid, "!document.querySelector('.speaker-mode')")) fail('did not leave SpeakerMode after End Presentation');
if (!await waitFor(sid, "!!document.querySelector('.editor-area')")) fail('editor did not return after End Presentation');
await sleep(300);

// 3. Now present again the ORDINARY single-window way (the plain Present button with
//    projector mode off, and the seam, both do exactly this: setPresenting(true)).
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
await sleep(600);
const r = await exec(sid, `return {
  speaker: !!document.querySelector('.speaker-mode'),
  present: !!document.querySelector('.present-slide'),
};`);
if (r.speaker) problems.push(`OBSERVED: entering plain present after a screen-share session shows SpeakerMode again (stale multiMonitorPresenting=true). EXPECTED: the live slide (.present-slide).`);
if (!r.present && !r.speaker) problems.push(`OBSERVED: neither SpeakerMode nor .present-slide rendered on re-present`);

await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);").catch(()=>{});
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('STALEFLAG_PASS: after ending a screen-share/speaker session, plain present shows the live slide (multiMonitorPresenting reset correctly)');
process.exit(0);
