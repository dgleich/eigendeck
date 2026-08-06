// "Generate Missing Snapshots" (#109-adjacent): captureAllSnapshots flips through
// the deck so each live element (demo/notebook/video) re-captures a static preview
// for export/print/thumbnails. Drives the REAL app: clear a demo's cached preview
// (simulate a freshly-opened deck with holes), run the snapshot capture via the
// seam, and assert the preview cache row comes back.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){try{const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}catch{return null}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('SNAPSHOT_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// Find a live element (demo/demo-piece/notebook/video) + its preview key (syncId??id).
const info=JSON.parse(await exec(sid,`
  const isLive=t=>t==='demo'||t==='demo-piece'||t==='video'||t==='notebook';
  const s=window.__eigendeck.store.getState();
  for(let i=0;i<s.presentation.slides.length;i++){
    for(const el of s.presentation.slides[i].elements){
      if(isLive(el.type)) return JSON.stringify({key:el.syncId||el.id, id:el.id, type:el.type, slide:i});
    }
  }
  return 'null';
`));
if(!info) fail('deck has no live element to snapshot');
console.log(`  target: ${info.type} ${info.id} (key ${info.key}) on slide ${info.slide}`);

const hasPreview=async()=>exec(sid,`
  const v=await window.__TAURI_INTERNALS__.invoke('db_list_asset_cache_variants',{sourceId:${JSON.stringify(info.key)}});
  return (v||[]).some(x=>x.variant==='preview');
`);

// Clear the preview → simulate a "missing" snapshot.
await exec(sid,`await window.__TAURI_INTERNALS__.invoke('db_clear_asset_cache',{sourceId:${JSON.stringify(info.key)}});`);
if(await hasPreview()) fail('preview still present after clear');
console.log('  cleared the preview (now missing)');

const runGen=async()=>{
  const res=await execA(sid,`const done=arguments[arguments.length-1];
    window.__eigendeck.captureSnapshots(false).then(r=>done(JSON.stringify(r))).catch(e=>done('ERR:'+e));`);
  if(typeof res!=='string'||res.startsWith('ERR:')) fail('captureSnapshots failed: '+res);
  return JSON.parse(res);
};

// Run 1: the cleared one is missing → captured.
const r=await runGen();
if(!r.captured) fail('captureSnapshots captured 0 (expected the cleared element)');
console.log(`  run 1: visited ${r.slidesVisited} slide(s), captured ${r.captured}/${r.totalLive}`);

// The preview should be back (with a short settle for the async persist).
let back=false;
for(let i=0;i<15;i++){ if(await hasPreview()){back=true;break;} await sleep(400); }
if(!back) fail('preview was NOT re-cached after Generate Missing Snapshots');
console.log('  preview re-cached ✓');

// Run 2 (the reported bug): nothing missing now → captured 0, visits 0 slides.
const r2=await runGen();
if(r2.captured!==0) fail(`run 2 should capture 0 (idempotent), captured ${r2.captured}`);
if(r2.slidesVisited!==0) fail(`run 2 should visit 0 slides (nothing missing), visited ${r2.slidesVisited}`);
console.log(`  run 2: idempotent — captured 0, visited 0 (nothing missing) ✓`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('SNAPSHOT_PASS: Generate Missing Snapshots re-captures a cleared live-element preview');
process.exit(0);
