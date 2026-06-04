// Notebook promote → save → close → reopen: the MASTER's recording must
// survive, the partner's discarded. Deck: nb1 (MARK_A) on slide 1, nb2 (MARK_B)
// on slide 2, independent. Link them, promote nb1 (master), save, quit; relaunch
// and assert the merged notebook shows MARK_A and not MARK_B.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await execSync(sid,"return document.body?document.body.textContent:''")||'');}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('NBPROMO_FAIL:',m);process.exit(1);};

// ---- Session 1: link nb1↔nb2, promote nb1, save, quit ----
let sid=await open(); if(!sid) fail('s1 no start');
if(!await waitSeam(sid)) fail('s1 deck not open');
for(let i=0;i<15;i++){await sleep(800); if((await dom(sid)).includes('MARK_A'))break;}  // notebook rendered
const r=await execAsync(sid,`
  const done=arguments[arguments.length-1];
  (async()=>{ const E=window.__eigendeck,s=E.store;
    s.getState().selectSlide(0); s.getState().linkElements('nb1',1,'nb2');
    s.getState().selectSlide(0); s.getState().promoteToSync('nb1');
    await new Promise(r=>setTimeout(r,1500));   // let the overlay reconcile settle
    await E.flush(); await E.save();
    done('saved');
  })().catch(e=>done('ERR:'+e));`);
if(r!=='saved') fail('s1 op/save: '+r);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
await sleep(2500);

// ---- Session 2: fresh launch on the saved file ----
let sid2=await open(); if(!sid2) fail('s2 no start');
if(!await waitSeam(sid2)) fail('s2 saved deck not open');
let txt=''; for(let i=0;i<18;i++){await sleep(800); txt=await dom(sid2); if(txt.includes('MARK_A')||txt.includes('MARK_B'))break;}
// Also confirm the structure collapsed to one entry.
const j=JSON.parse(await execAsync(sid2,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_export_json').then(d).catch(e=>d('ERR:'+e));"));
const a=j.slides[0].elements[0], b=j.slides[1].elements[0];
const oneEntry = a.id===b.id && !!a.syncId;
const keptA = txt.includes('MARK_A');
const droppedB = !txt.includes('MARK_B');
await fetch(`${BASE}/session/${sid2}`,{method:'DELETE'}).catch(()=>{});
if(oneEntry && keptA && droppedB){ console.log('NBPROMO_PASS: master recording (MARK_A) survived promote+save+reopen; one synced entry; MARK_B discarded'); process.exit(0); }
fail(`oneEntry=${oneEntry} keptA=${keptA} droppedB=${droppedB}`);
