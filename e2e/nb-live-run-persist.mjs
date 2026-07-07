// e2e: live external kernel — edit a notebook cell in-app, run it against a REAL
// jupyter kernel, assert the computed output, then save/quit/reopen and assert
// the edited source + live output both persisted (via the overlay).
//
// Needs a jupyter server (E2E_JUPYTER=1 → run-probe.sh boots e2e/jupyter-server.sh).
// Boilerplate (post/execSync/execAsync/dom/open/waitSeam) mirrors nb-promote-reload.mjs.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const JUP_URL=process.env.E2E_JUP_URL||'http://127.0.0.1:8888';
const JUP_TOKEN=process.env.E2E_JUP_TOKEN||'e2e-token';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await execSync(sid,"return document.body?document.body.textContent:''")||'');}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}

const fail=(m)=>{console.error('E2E_FAIL '+m);process.exit(1);};
async function pollDom(sid,needle,ms=20000){for(let t=0;t<ms;t+=500){if((await dom(sid)).includes(needle))return true;await sleep(500);}return false;}

(async () => {
  const sid = await open();
  if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');
  // inject the per-machine jupyterServers pref, then fire the pref-changed event
  // so usePreference('jupyterServers') re-reads (a raw setItem alone doesn't
  // notify subscribers, so the already-mounted notebook keeps its empty registry).
  await execSync(sid, `localStorage.setItem('eigendeck:pref:jupyterServers', JSON.stringify(
    [{ label: 'e2e', baseUrl: ${JSON.stringify(JUP_URL)}, token: ${JSON.stringify(JUP_TOKEN)}, availableKernels: ['python3'] }]));
    window.dispatchEvent(new CustomEvent('eigendeck:pref-changed', { detail: { key: 'jupyterServers' } }));`);
  if (!await pollDom(sid, 'k = 5')) fail('cell source k = 5 not rendered');

  // enter interact mode (double-click the overlay) so cell buttons + editor take input
  await execSync(sid, `document.querySelector('.el-notebook .nb-overlay')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));`);
  // wait for the CodeMirror editor to mount (lazy-loaded)
  for (let t = 0; t < 15000 && !(await execSync(sid, `return !!document.querySelector('.cm-content')`)); t += 500) await sleep(500);
  // edit: replace the CodeMirror doc with a computed-output line
  const NEWSRC = 'print("E2E_LIVE_%d" % (6*7))';
  const setOk = await execSync(sid, `return (() => {
    const cm = document.querySelector('.cm-content');
    if (!cm) return 'no-cm';
    cm.focus();
    const sel = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(cm); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertText', false, ${JSON.stringify(NEWSRC)});
    return document.querySelector('.cm-content')?.textContent?.includes('E2E_LIVE') ? 'ok' : 'no-set';
  })();`);
  if (setOk !== 'ok') fail('could not set cell source via CodeMirror (' + setOk + ') — see FALLBACK in plan');
  // blur the editor → onCommit → ov.setEdit → the source edit lands in cellEdits
  // (without this only cellOutputs persists; the edited source is lost on reopen)
  await execSync(sid, `document.querySelector('.cm-content')?.blur();`);
  await sleep(400);
  // run the cell (lazy WS connect happens here)
  const runBtn = await execSync(sid, `return !!document.querySelector('.nb-cell-run')`);
  await execSync(sid, `document.querySelector('.nb-cell-run')?.click();`);
  if (!await pollDom(sid, 'E2E_LIVE_42', 30000)) {
    const diag = await execSync(sid, `return JSON.stringify({
      runBtnPresent: ${runBtn},
      pref: localStorage.getItem('eigendeck:pref:jupyterServers'),
      kernelLabel: document.querySelector('.nb-kernel-label')?.textContent || null,
      status: document.querySelector('.nb-status')?.textContent || null,
      pill: document.querySelector('.server-status-pill,[class*=status-pill]')?.textContent || null,
      nbText: (document.querySelector('.nb-body')?.textContent || '').slice(0, 400),
    })`);
    console.error('DIAG ' + diag);
    fail('live kernel output E2E_LIVE_42 not seen');
  }
  console.log('E2E_OK live-run');

  // The overlay (cellEdits + cellOutputs) persists via its OWN debounced flush
  // (useOverlay FLUSH_DEBOUNCE_MS=800, writes db_store_asset directly — NOT via
  // window.__eigendeck.save). Wait out the debounce + async write while the
  // session is still alive; a hard session close won't run the unmount flush.
  await sleep(2000);

  // persist store deltas too (slide/element), then close the session
  const saved = await execAsync(sid, `const d=arguments[arguments.length-1];
    (async()=>{ await window.__eigendeck.flush(); await window.__eigendeck.save(); })()
      .then(()=>d('saved')).catch(e=>d('ERR:'+e));`);
  if (saved !== 'saved') fail('save failed: ' + saved);
  await sleep(800);
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  await sleep(1500);

  // reopen fresh (new XDG_DATA_HOME → no kernel; the overlay renders edit+output
  // WITHOUT a live kernel, which is exactly what we're asserting persisted)
  const sid2 = await open();
  if (!sid2) fail('no reopen session');
  if (!await waitSeam(sid2)) fail('no seam on reopen');
  if (!await pollDom(sid2, 'E2E_LIVE_42')) fail('live output did NOT persist across reopen');
  if (!await pollDom(sid2, 'E2E_LIVE_%d')) fail('edited source did NOT persist across reopen');
  await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});
  console.log('E2E_PASS live edit+run+persist');
  process.exit(0);
})();
