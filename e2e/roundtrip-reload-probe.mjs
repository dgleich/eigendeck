// TRUE close-and-reopen round trip: session 1 opens the deck, runs a store op,
// flushes + SAVES to the file, then quits. Session 2 launches a FRESH app on the
// same file and asserts the persisted structure. E2E_MODE = linkpromote|duplicate.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK, MODE=process.env.E2E_MODE;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){ for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);} return null; }
async function waitSeam(sid){ for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store&&window.__eigendeck.store.getState().projectPath)"))return true;} return false; }
const fail=(m)=>{console.error('RELOAD_FAIL:',m);process.exit(1);};

const OP = MODE==='duplicate'
  ? "s.getState().selectSlide(0); s.getState().duplicateSlide(0);"
  : "s.getState().selectSlide(0); s.getState().linkElements('A',1,'B'); s.getState().selectSlide(0); s.getState().promoteToSync('A');";

// ---- Session 1: op + flush + SAVE, then quit ----
let sid = await open();
if(!sid) fail('session 1 did not start');
if(!await waitSeam(sid)) fail('session 1: deck never opened');
const r1 = await execAsync(sid, `
  const done=arguments[arguments.length-1];
  (async()=>{ const E=window.__eigendeck, s=E.store; ${OP} await E.flush(); await E.save(); done('saved'); })().catch(e=>done('ERR:'+e));
`);
if(r1!=='saved') fail('session 1 op/save failed: '+r1);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});  // QUIT the app
await sleep(2500);  // let the process fully exit + file settle

// ---- Session 2: fresh launch on the saved file ----
let sid2 = await open();
if(!sid2) fail('session 2 did not start');
if(!await waitSeam(sid2)) fail('session 2: saved deck never opened');
const j = JSON.parse(await execAsync(sid2, "const d=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('db_export_json').then(x=>d(x)).catch(e=>d('ERR:'+e));"));
const S = j.slides;

if(MODE==='duplicate'){
  if(S.length!==2) fail(`expected 2 slides, got ${S.length}`);
  const a=S[0].elements[0], b=S[1].elements[0];
  if(a.id!==b.id) fail(`not one entry after reload (${a.id} vs ${b.id})`);
  if(!a.syncId || a.syncId!==b.syncId) fail(`syncId not shared after reload (${a.syncId} vs ${b.syncId})`);
  console.log('  RELOAD duplicate ok: one synced entry survived close+reopen');
} else {
  const a=S[0].elements[0], b=S[1].elements[0];
  if(a.id!==b.id) fail(`promote: not one entry after reload (${a.id} vs ${b.id})`);
  if(!a.syncId) fail('promote: syncId missing after reload');
  console.log('  RELOAD linkpromote ok: promoted sync is one entry after close+reopen');
}
await fetch(`${BASE}/session/${sid2}`,{method:'DELETE'}).catch(()=>{});
console.log('RELOAD_PASS '+MODE);
process.exit(0);
