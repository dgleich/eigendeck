// Verify sync/link operations survive the REAL in-session→flush→export path:
// drive a store action, await flushToSqlite (write-through to the open SQLite),
// then db_export_json (which re-derives syncId from junction counts) and assert
// the persisted structure. E2E_MODE = 'linkpromote' | 'duplicate'.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK, MODE=process.env.E2E_MODE;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}

let sid;
for(let i=0;i<12&&!sid;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});sid=j?.value?.sessionId;if(!sid)await sleep(1000);}
if(!sid){console.error('NO SESSION');process.exit(2);}
// Wait for boot + the deck to open (the seam appears).
for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store&&window.__eigendeck.store.getState().projectPath)"))break;}

// Run a store op, flush, and return the exported persisted JSON.
async function opThenExport(opBody){
  const r = await execAsync(sid, `
    const done = arguments[arguments.length-1];
    (async () => {
      const E = window.__eigendeck; const s = E.store;
      ${opBody}
      await E.flush();
      const inv = window.__TAURI_INTERNALS__.invoke;
      const json = await inv('db_export_json');
      done(json);
    })().catch(e => done('ERR:'+e));
  `);
  if(typeof r==='string' && r.startsWith('ERR:')) throw new Error(r);
  return JSON.parse(r);
}
const fail=(m)=>{console.error('ROUNDTRIP_FAIL:',m);process.exit(1);};
const slides=(j)=>j.slides;

if(MODE==='linkpromote'){
  // LINK A↔B (cross-slide animation link): shared linkId, separate positions, NO syncId.
  let j = await opThenExport("s.getState().selectSlide(0); s.getState().linkElements('A',1,'B');");
  let A = slides(j)[0].elements[0], B = slides(j)[1].elements[0];
  if(!(A.linkId && A.linkId===B.linkId)) fail(`link: linkId not shared (A=${A.linkId} B=${B.linkId})`);
  if(A.syncId||B.syncId) fail(`link: must NOT be synced (A.syncId=${A.syncId} B.syncId=${B.syncId})`);
  if(A.position.x!==100 || B.position.x!==600) fail(`link: positions not preserved (A.x=${A.position.x} B.x=${B.position.x})`);
  console.log('  LINK ok: shared linkId, separate positions, no syncId');

  // PROMOTE A → sync: the two collapse to ONE entry (same element id on both slides + syncId).
  j = await opThenExport("s.getState().selectSlide(0); s.getState().promoteToSync('A');");
  A = slides(j)[0].elements[0]; B = slides(j)[1].elements[0];
  if(A.id!==B.id) fail(`promote: not one entry (ids ${A.id} vs ${B.id})`);
  if(!A.syncId) fail('promote: syncId missing after save');
  // exactly one element row underneath (one entry)
  const inv = await execAsync(sid, "const d=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('db_export_json').then(()=>d('ok'));");
  console.log('  PROMOTE ok: one entry (shared id + syncId on both slides)');
  console.log('ROUNDTRIP_PASS linkpromote');
} else if(MODE==='duplicate'){
  // DUPLICATE slide → the element is synced across both slides as ONE entry.
  const j = await opThenExport("s.getState().selectSlide(0); s.getState().duplicateSlide(0);");
  if(slides(j).length!==2) fail(`duplicate: expected 2 slides, got ${slides(j).length}`);
  const A0 = slides(j)[0].elements[0], A1 = slides(j)[1].elements[0];
  if(A0.id!==A1.id) fail(`duplicate: not one entry (ids ${A0.id} vs ${A1.id})`);
  if(!A0.syncId || A0.syncId!==A1.syncId) fail(`duplicate: syncId not shared (${A0.syncId} vs ${A1.syncId})`);
  console.log('  DUPLICATE ok: one entry (shared id + syncId across both slides)');
  console.log('ROUNDTRIP_PASS duplicate');
} else fail('unknown MODE '+MODE);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
process.exit(0);
