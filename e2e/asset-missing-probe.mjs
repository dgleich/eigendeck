// Missing-source detection (#74), end-to-end with the REAL on-open scan.
//
//  S1: write img.svg, store it as a linked asset (external_path), add an image
//      element, save the deck, quit.
//  delete img.svg on disk.
//  S2: reopen → openSqliteProject's scanForChangedAssets stats the now-missing
//      file → marks it missing. Assert window.__eigendeck.missingAssets() lists it.
//  re-create img.svg.
//  S3: reopen → scan stats OK → clears the flag. Assert the list is empty again.
//
// Run via run-probe.sh with HOME=<deck dir> so the deck + source are in the
// fs:allow-watch / read scope. E2E_DECK must be an empty deck under HOME.
import { writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { trustAndWatchAllViaUI } from './_ui.mjs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const IMG = join(dirname(DECK), 'img.svg');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('AM_FAIL:',m);process.exit(1);};
// Asset-security: a CLI-built fixture is untrusted, so the on-open scan performs
// ZERO disk reads (no missing detection). Trust it — the real "Trust this deck"
// action — so the scan runs and reconciles the linked source. Idempotent per session.
// Trust + watch-all through the REAL Security window (no action seam). Keeps the
// local `trust(sid)` shape ('ok'/'ERR') so existing call sites are unchanged.
const trust = (sid) => trustAndWatchAllViaUI(sid).then((ok) => (ok ? 'ok' : 'ERR'));
// poll the seam's missing list for `id` to (dis)appear
async function pollMissing(sid, wantPresent, id){
  for(let i=0;i<20;i++){
    await sleep(700);
    const list = await exec(sid, "try{return JSON.stringify(window.__eigendeck.missingAssets().map(m=>m.assetId));}catch(e){return '[]';}");
    let ids=[]; try{ids=JSON.parse(list);}catch{}
    const has = ids.includes(id);
    if (has === wantPresent) return ids;
  }
  return null;
}

// ===== S1: create the linked asset + element, save, quit =====
writeFileSync(IMG, SVG);
let sid = await open(); if(!sid || !await waitSeam(sid)) fail('S1 open');
const stored = await execA(sid, `const d=arguments[arguments.length-1];const enc=new TextEncoder().encode(${JSON.stringify(SVG)});window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'img.svg',data:Array.from(enc),mimeType:'image/svg+xml',externalPath:'img.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
if (stored !== 'ok') fail('store asset: '+stored);
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:200,y:150,width:400,height:400}});");
if (await trust(sid) !== 'ok') fail('S1 trust');   // trust + approve img.svg, persists the token
const saved = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
if (saved !== 'ok') fail('save: '+saved);
await sleep(800);
await quit(sid);
console.log('  S1: asset stored + element added + saved');

// ===== delete the source, reopen, expect missing =====
unlinkSync(IMG);
sid = await open(); if(!sid || !await waitSeam(sid)) fail('S2 open');
await trust(sid);   // re-establish trust in this session; rescans (source now missing)
const m1 = await pollMissing(sid, true, 'ia1');
await quit(sid);
if (!m1 || !m1.includes('ia1')) fail(`missing NOT detected on reopen (got ${JSON.stringify(m1)})`);
console.log('  S2: deleted source → detected missing on reopen ✓');

// ===== re-create the source, reopen, expect cleared =====
writeFileSync(IMG, SVG);
sid = await open(); if(!sid || !await waitSeam(sid)) fail('S3 open');
await trust(sid);   // re-approve the restored source + rescan → flag clears
const m2 = await pollMissing(sid, false, 'ia1');
await quit(sid);
if (m2 === null) fail(`missing flag NOT cleared after source restored (still ${JSON.stringify(await exec(sid,"try{return JSON.stringify(window.__eigendeck.missingAssets());}catch(e){return '[]';}"))})`);
console.log('  S3: restored source → flag cleared on reopen ✓');

console.log('AM_PASS: missing-source detect + clear via real on-open scan');
process.exit(0);
