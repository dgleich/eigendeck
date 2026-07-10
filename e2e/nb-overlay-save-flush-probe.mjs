// e2e (#123): a notebook SOURCE edit must survive a deck save that happens
// WITHIN the overlay's 800ms debounce, followed by a HARD session close (no
// graceful React unmount). This is the exact data-loss race: without the
// save-path force-flush (src/lib/overlayFlushRegistry, called from flushToSqlite
// + the clean-quit handler), an edit + immediate save() + hard-close loses the
// overlay because its own debounce never fired.
//
// Discriminating by construction: on the FIX it passes; with the force-flush
// removed it fails (overlay lost). Kernel-free — it edits the cell source and
// never runs a cell, so no jupyter server is needed.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function execSync(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value }
async function execAsync(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value }
async function dom(sid) { return String(await execSync(sid, "return document.body?document.body.textContent:''") || ''); }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 20; i++) { await sleep(800); if (await execSync(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function pollDom(sid, needle, ms = 20000) { for (let t = 0; t < ms; t += 500) { if ((await dom(sid)).includes(needle)) return true; await sleep(500); } return false; }
const fail = (m) => { console.error('SAVEFLUSH_FAIL ' + m); process.exit(1); };
const MARKER = 'E2E_SAVEFLUSH_MARKER';

(async () => {
  const sid = await open(); if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');
  // Register a (down) jupyter server so the notebook UI is in its normal state;
  // we never run a cell, so it need not be reachable.
  await execSync(sid, `localStorage.setItem('eigendeck:pref:jupyterServers', JSON.stringify(
    [{ label: 'e2e', baseUrl: 'http://127.0.0.1:8888', token: 'x', availableKernels: ['python3'] }]));
    window.dispatchEvent(new CustomEvent('eigendeck:pref-changed', { detail: { key: 'jupyterServers' } }));`);
  if (!await pollDom(sid, 'k = 5')) fail('initial cell source (k = 5) not rendered');

  // enter interact mode + wait for CodeMirror to mount (lazy-loaded)
  await execSync(sid, `document.querySelector('.el-notebook .nb-overlay')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));`);
  for (let t = 0; t < 15000 && !(await execSync(sid, `return !!document.querySelector('.cm-content')`)); t += 500) await sleep(500);
  if (!(await execSync(sid, `return !!document.querySelector('.cm-content')`))) fail('no CodeMirror editor');

  // Edit the source, COMMIT it to the overlay (blur fires onCommit → ov.setEdit;
  // keystrokes alone only sit in the transient live.working map), then save in
  // the SAME tick — well within the 800ms overlay flush debounce. flushNow reads
  // the shared overlayCache, so save()'s force-flush persists the committed edit.
  const res = await execAsync(sid, `const d=arguments[arguments.length-1];
    (async () => {
      const cm=document.querySelector('.cm-content'); if(!cm) return 'no-cm';
      cm.focus();
      const sel=window.getSelection(); const r=document.createRange();
      r.selectNodeContents(cm); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertText', false, ${JSON.stringify(MARKER)});
      if(!(cm.textContent||'').includes(${JSON.stringify(MARKER)})) return 'edit-failed';
      cm.blur();                                        // commit edit -> overlay (onCommit)
      if(document.body.focus) document.body.focus();
      await new Promise(res => setTimeout(res, 200));   // let onCommit -> ov.setEdit -> overlayCache
      await window.__eigendeck.flush();
      await window.__eigendeck.save();
      return 'saved';
    })().then(d).catch(e => d('ERR:' + e));`);
  if (res !== 'saved') fail('edit+save failed: ' + res);

  // HARD-close at once — before the 800ms debounce or any unmount flush. The
  // overlay is on disk ONLY if save() force-flushed it.
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  await sleep(1500);

  // Reopen fresh: assert the edit persisted and the original source is gone.
  const sid2 = await open(); if (!sid2) fail('no reopen session');
  if (!await waitSeam(sid2)) fail('no seam on reopen');
  if (!await pollDom(sid2, MARKER)) fail('edited source did NOT persist (overlay lost on save-within-debounce + hard-close)');
  if (await pollDom(sid2, 'k = 5', 2500)) fail('original source (k = 5) still present — the edit was not what persisted');
  await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});
  console.log('SAVEFLUSH_PASS overlay survives save-within-debounce + hard-close');
  process.exit(0);
})();
