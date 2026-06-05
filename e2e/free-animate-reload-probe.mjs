// S5c — the duplicate → free → move → animate workflow must survive save/reopen.
//
// Deck: one notebook `nb1` (recording MARK_A) on slide 1.
// Steps: duplicate the slide (synced + a DORMANT linkId from duplicateSlide),
// free the slide-2 instance (drops syncId → its position goes independent, the
// linkId activates), move it +300, save, reopen.
//
// Expected on reopen: TWO separate rows — slide 1 at the original x, slide 2 at
// the moved x, neither synced, BOTH sharing one linkId (the animation pairing),
// and the recording reachable on the moved frame.
//
// E2E_MODE = samesession | settled  (settled = save+reopen after duplicate, so
// the instances share the canonical id before the free — the harder case).
//
// BUG today: reopen collapses to ONE entry, both slides {id:nb1, syncId:nb1,
// x:60} — the free AND the move are lost, cloned overlay orphaned.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const MODE=process.env.E2E_MODE||'samesession';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function dom(sid){return String(await execSync(sid,"return document.body?document.body.textContent:''")||'');}
async function waitDom(sid,s,n=18){for(let i=0;i<n;i++){await sleep(700);if((await dom(sid)).includes(s))return true;}return false;}
async function run(sid,body){return await execAsync(sid,`const done=arguments[arguments.length-1];(async()=>{const E=window.__eigendeck,s=E.store;${body}})().catch(e=>done('ERR:'+e));`);}
async function exportJson(sid){return JSON.parse(await execAsync(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_export_json').then(d).catch(e=>d('ERR:'+e));"));}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('FAR_FAIL ['+MODE+']:',m);process.exit(1);};

// ---- Session 1: get to a settled-or-not duplicated state, then free+move+save
let sid=await open(); if(!sid||!await waitSeam(sid)) fail('s1 open');
if(!await waitDom(sid,'MARK_A')) fail('s1 MARK_A not shown');
await run(sid,`s.getState().selectSlide(0); s.getState().duplicateSlide(0); await new Promise(r=>setTimeout(r,400)); await E.flush(); await E.save(); done('ok');`);

if(MODE==='settled'){ await quit(sid); await sleep(2500); sid=await open(); if(!sid||!await waitSeam(sid)) fail('settle reopen'); await sleep(1500); }

const r1=await run(sid,`
  s.getState().selectSlide(1);
  const cid=s.getState().presentation.slides[1].elements[0].id;
  s.getState().freeElement(cid);
  await new Promise(r=>setTimeout(r,150));
  const fid=s.getState().presentation.slides[1].elements[0].id;   // id after free (may differ once fixed)
  s.getState().moveElementsBy([fid],300,0);
  await new Promise(r=>setTimeout(r,200));
  await E.flush(); await E.save();
  done(JSON.stringify(s.getState().presentation.slides.map(sl=>sl.elements.map(e=>({id:e.id,sync:e.syncId,link:e.linkId,x:e.position.x})))));
`);
console.log('  in-session:',r1);
await quit(sid); await sleep(2500);

// ---- Session 2: fresh launch, assert persisted structure
let sid2=await open(); if(!sid2||!await waitSeam(sid2)) fail('s2 open');
await sleep(1500);
const j=await exportJson(sid2);
const S=j.slides;
console.log('  reopen:',JSON.stringify(S.map(s=>s.elements.map(e=>({id:e.id,sync:e.syncId,link:e.linkId,x:e.position.x})))));
if(S.length!==2) fail(`expected 2 slides, got ${S.length}`);
const a=S[0].elements[0], b=S[1].elements[0];
if(!a||!b) fail('a slide lost its element');
if(a.id===b.id) fail(`(1) collapsed to one row — ids equal (${a.id})`);
if(a.position.x!==60 || b.position.x!==360) fail(`(2) positions wrong: a=${a.position.x} b=${b.position.x} (want 60/360)`);
if(a.syncId || b.syncId) fail(`(3) still synced: a.sync=${a.syncId} b.sync=${b.syncId}`);
if(!a.linkId || a.linkId!==b.linkId) fail(`(4) animation linkId not shared: ${a.linkId} vs ${b.linkId}`);
// (5) recording reachable on the moved (slide-2) frame
await run(sid2,`s.getState().selectSlide(1); done('ok');`);
if(!await waitDom(sid2,'MARK_A')) fail('(5) recording MARK_A not on the moved frame');
await quit(sid2);
console.log('FAR_PASS ['+MODE+'] two rows, moved frame persists + linked + recording intact');
process.exit(0);
