// a3 bug-hunt: notebook overlay DISCARD + quick-remount race.
//
// Deck: make_overlay_deck "single" — a notebook whose overlay edits cell 0 to
// "k = 999  # EDITED_OVERLAY_MARKER"; the pristine .ipynb source is "k = 5".
//
// Scenario A (discard reverts): fire eigendeck:discard-overlay for the .ipynb
//   asset -> the merged render must revert to the deck's stored source ("k = 5")
//   and the edit marker must disappear.
// Scenario B (discard durability across quick remount): after discard, remount
//   the element FAST (switch slide away+back within the 800ms flush debounce)
//   BEFORE the empty overlay is flushed. If the mount-time DB load re-reads the
//   still-on-disk old overlay, the discard is silently UNDONE (marker returns).
//
// Kernel-free (overlay is a baked asset edit; no cell run needed).
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const IPYNB_ID = 'ipynb-1';                 // asset id from make_overlay_deck.py
const MARKER = 'EDITED_OVERLAY_MARKER';
const PRISTINE = 'k = 5';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function execSync(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value }
async function dom(sid) { return String(await execSync(sid, "return document.body?document.body.textContent:''") || ''); }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await execSync(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function pollDom(sid, needle, ms = 15000) { for (let t = 0; t < ms; t += 400) { if ((await dom(sid)).includes(needle)) return true; await sleep(400); } return false; }
async function absent(sid, needle, ms = 4000) { for (let t = 0; t < ms; t += 400) { if (!(await dom(sid)).includes(needle)) return true; await sleep(400); } return !(await dom(sid)).includes(needle); }
const fail = (m) => { console.error('A3DISCARD_FAIL ' + m); process.exit(1); };

(async () => {
  const sid = await open(); if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');

  // The edited overlay must be showing first.
  if (!await pollDom(sid, MARKER)) fail('overlay edit (' + MARKER + ') never rendered');
  if (await dom(sid).then(d => d.includes(PRISTINE))) fail('pristine source visible before discard — overlay not applied');

  // ---- Scenario A: discard reverts to the stored deck source. ----
  await execSync(sid, `window.dispatchEvent(new CustomEvent('eigendeck:discard-overlay',{detail:{assetId:${JSON.stringify(IPYNB_ID)}}}))`);
  if (!await pollDom(sid, PRISTINE, 6000)) fail('A: after discard, pristine source (' + PRISTINE + ') did not appear');
  if (!await absent(sid, MARKER, 4000)) fail('A: after discard, edit marker still present (overlay not dropped)');
  console.log('A3DISCARD_A_OK discard reverted to stored deck source');

  // ---- Scenario B: quick remount BEFORE the empty overlay is flushed. ----
  // First rebuild the edited overlay state in-session so we have something to
  // discard again: reopen fresh (the on-disk overlay is still the edited one
  // UNLESS scenario A's empty flush already persisted). To isolate the race we
  // reopen a NEW session so the DB still holds the original edited overlay.
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  await sleep(1000);
  const sid2 = await open(); if (!sid2) fail('no reopen session');
  if (!await waitSeam(sid2)) fail('no seam on reopen');

  // If scenario A's discard PERSISTED to disk, the reopened deck already shows
  // pristine — then the durability question is moot (discard stuck). Report it.
  const startedPristine = await pollDom(sid2, PRISTINE, 4000);
  if (startedPristine && !(await dom(sid2)).includes(MARKER)) {
    console.log('A3DISCARD_B_NOTE discard from scenario A persisted to disk (reopen shows pristine) — quick-remount race not reachable; discard is durable');
    await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});
    console.log('A3DISCARD_PASS');
    process.exit(0);
  }

  // Otherwise the edited overlay is back. Discard again, then IMMEDIATELY force a
  // remount by toggling currentSlideIndex away and back (no await between) so the
  // element unmounts + remounts within the flush debounce.
  if (!await pollDom(sid2, MARKER, 6000)) fail('B: edited overlay not present on reopen (cannot set up race)');
  await execSync(sid2, `
    window.dispatchEvent(new CustomEvent('eigendeck:discard-overlay',{detail:{assetId:${JSON.stringify(IPYNB_ID)}}}));
  `);
  // give React one tick to apply the clear, then remount fast.
  await sleep(120);
  // Add a throwaway slide and navigate to force unmount, then back — all well
  // within the 800ms overlay flush debounce.
  await execSync(sid2, `
    const st = window.__eigendeck.store.getState();
    st.addSlide();                 // inserts at index 1 AND navigates there -> slide 0 unmounts
  `);
  await sleep(150);
  await execSync(sid2, `window.__eigendeck.store.getState().selectSlide(0);`);  // back -> slide 0 remounts
  // Now on slide 0 again: if the discard was durable across the fast remount,
  // we should see pristine and NOT the marker. If the mount reloaded the stale
  // on-disk overlay, the marker returns => BUG.
  const markerBack = await pollDom(sid2, MARKER, 3000);
  const pristineShown = (await dom(sid2)).includes(PRISTINE);
  await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});
  if (markerBack) {
    console.error('A3DISCARD_FAIL B: discard was UNDONE by a quick remount within the flush debounce — the mount reloaded the stale on-disk overlay (marker=' + markerBack + ', pristine=' + pristineShown + ')');
    process.exit(1);
  }
  if (!pristineShown) fail('B: after remount neither marker nor pristine visible (render broken)');
  console.log('A3DISCARD_B_OK discard survived a quick remount within the debounce');
  console.log('A3DISCARD_PASS');
  process.exit(0);
})();
