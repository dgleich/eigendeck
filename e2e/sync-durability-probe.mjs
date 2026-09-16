// Durability angle: an unsync that is NOT explicitly saved must still survive a
// reload (it rides the 1s autosave debounce + must flush on close). This is the
// path the forensics point to — frees that left NO trace = never written.
//
// E2E_MODE:
//   nosave  — free, then quit IMMEDIATELY (inside the 1s debounce), no flush/save
//   settled — free, wait 1.6s for the debounce to fire, then quit (control: should persist)
// Bug reproduces (nosave) if slide-2 comes back SYNCED after reload.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const MODE=process.env.E2E_MODE||'nosave';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function run(sid,body){return await execAsync(sid,`const done=arguments[arguments.length-1];(async()=>{const E=window.__eigendeck,s=E.store;${body}})().catch(e=>done('ERR:'+e));`);}
async function exportJson(sid){return JSON.parse(await execAsync(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_export_json').then(d).catch(e=>d('ERR:'+e));"));}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('SYNCDUR_FAIL ['+MODE+']:',m);process.exit(1);};
function legends(json){return json.slides.map((sl)=>{const el=(sl.elements||[]).find(e=>((e.html||'')).includes('SYNCED-LEGEND'));return el?{id:el.id.slice(0,8),synced:!!el.syncId}:null;});}

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
await sleep(1200);
const base=legends(await exportJson(sid));
console.log('  baseline:',JSON.stringify(base));

// Free slide-2 (index 1). NO explicit E.flush()/E.save().
await run(sid,`
  s.getState().selectSlide(1);
  const el=s.getState().presentation.slides[1].elements.find(e=>((e.html||'')).includes('SYNCED-LEGEND'));
  s.getState().freeElement(el.id);
  done('freed (isDirty='+s.getState().isDirty+')');
`);
console.log('  freed, isDirty:', (await execSync(sid,"return window.__eigendeck.store.getState().isDirty")));
const inMem=legends(await exportJson(sid));  // NOTE: db_export_json reads the DB — shows what's PERSISTED so far
console.log('  right after free (db state):',JSON.stringify(inMem));

if(MODE==='settled'){ await sleep(1600); }  // let the 1s debounce fire
await quit(sid); await sleep(2500);

let sid2=await open(); if(!sid2||!await waitSeam(sid2)) fail('reopen');
await sleep(1200);
const after=legends(await exportJson(sid2));
console.log('  after reopen:',JSON.stringify(after));
if(after[1].id===base[0].id||after[1].synced)
  fail(`REPRO [${MODE}] — unsync REVERTED after reload: slide-2 back to synced/grp1 ${JSON.stringify(after)}`);
await quit(sid2);
console.log(`SYNCDUR_PASS [${MODE}]: unsync survived reload.`);
process.exit(0);
