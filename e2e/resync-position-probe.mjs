// S2 — resync must reconcile position (decision: SNAP TO CANONICAL).
//
// Deck: notebook `nb1` on slide 1. Duplicate (synced). Free the slide-2
// instance, move it +200 (positions diverge to [60, 260]). Then resync.
//
// Decision (David, 2026-06): resync = rejoin the group and ADOPT the other
// members' (canonical) position; the move is discarded. (Keeping the move = stay
// freed as an animation frame.)
//
// Expected: after resync, ALL instances share the canonical x (60) IN-SESSION —
// never two synced members at different x. Moving one afterwards moves all and
// they stay equal (no permanent offset). Reopen: one synced entry at the last
// canonical x.
//
// BUG today: resync only flips _syncId→syncId without reconciling position, so
// in-session is [60, 260] (two synced members, different x — invariant
// violation) and reload silently snaps to [60, 60].
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
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
const fail=(m)=>{console.error('RSP_FAIL:',m);process.exit(1);};
const xs=arr=>JSON.stringify(arr);

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
if(!await waitDom(sid,'MARK_A')) fail('MARK_A not shown');
const r=await run(sid,`
  const px=()=>s.getState().presentation.slides.map(sl=>sl.elements[0]?.position.x);
  s.getState().selectSlide(0); s.getState().duplicateSlide(0);
  await new Promise(r=>setTimeout(r,300));
  s.getState().selectSlide(1);
  const cid=s.getState().presentation.slides[1].elements[0].id;
  s.getState().freeElement(cid);
  s.getState().moveElementsBy([cid],200,0);
  await new Promise(r=>setTimeout(r,100));
  const diverged=px();                       // [60, 260]
  s.getState().resyncElement(cid);
  await new Promise(r=>setTimeout(r,100));
  const afterResync=px();                     // EXPECT [60, 60] (snap to canonical)
  // moving one synced instance now moves all, staying equal:
  const rid=s.getState().presentation.slides[1].elements[0].id;
  s.getState().moveElementsBy([rid],10,0);
  await new Promise(r=>setTimeout(r,100));
  const afterMove=px();                        // EXPECT [70, 70]
  await E.flush(); await E.save();
  done(JSON.stringify({diverged,afterResync,afterMove}));
`);
console.log('  in-session:',r);
const st=JSON.parse(r);
if(xs(st.afterResync)!==xs([60,60])) fail(`resync did not snap to canonical: afterResync=${xs(st.afterResync)} (want [60,60])`);
if(xs(st.afterMove)!==xs([70,70])) fail(`synced move after resync not mirrored/equal: afterMove=${xs(st.afterMove)} (want [70,70])`);
await quit(sid); await sleep(2500);

let sid2=await open(); if(!sid2||!await waitSeam(sid2)) fail('reopen');
await sleep(1500);
const j=await exportJson(sid2);
const S=j.slides;
console.log('  reopen:',JSON.stringify(S.map(s=>s.elements.map(e=>({id:e.id,sync:e.syncId,x:e.position.x})))));
const a=S[0].elements[0], b=S[1].elements[0];
if(a.id!==b.id || !a.syncId || a.syncId!==b.syncId) fail(`not one synced entry after reopen (${a.id}/${a.syncId} vs ${b.id}/${b.syncId})`);
if(a.position.x!==70 || b.position.x!==70) fail(`reopen positions not canonical 70: ${a.position.x}/${b.position.x}`);
await quit(sid2);
console.log('RSP_PASS resync snapped to canonical, group stays position-locked, round-trips');
process.exit(0);
