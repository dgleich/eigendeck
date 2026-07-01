// #74 relocate-all-by-offset: moving a whole asset folder, then relocating ONE
// file, should auto-relocate the OTHER missing files by the same path delta.
//
//  S1: images/a.svg, images/b.svg, images/sub/c.svg → 3 linked assets, save, quit.
//  move: delete images/, recreate the same tree under moved/images/ with NEW bytes.
//  S2: reopen → all 3 missing. Relocate asset 'ra' (→ moved/images/a.svg), then
//      call relocateByOffset → asserts rb + rc auto-relocate and now read the
//      NEW bytes from the moved location.
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const HOME=dirname(DECK);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('RO_FAIL:',m);process.exit(1);};
// Trust the (untrusted) CLI fixture so the on-open scan runs + relocate can read from
// disk. Offset-relocate then approves each moved sibling itself (the anchor pick's
// consent extends to its folder) — see relocateMissingByOffset.
const trust=(sid)=>execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.trustDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const missing=(sid)=>exec(sid,"try{return JSON.stringify(window.__eigendeck.missingAssets().map(m=>m.assetId).sort());}catch(e){return '[]';}");
const byteLen=(sid,id)=>execA(sid,`const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'${id}'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));`);
async function pollMissingGone(sid,id){for(let i=0;i<20;i++){await sleep(600);const m=JSON.parse(await missing(sid));if(!m.includes(id))return true;}return false;}

const store=(sid,path,id)=>execA(sid,`const d=arguments[arguments.length-1];const enc=new TextEncoder().encode('x'.repeat(arguments[0]||10));window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(enc),mimeType:'image/svg+xml',externalPath:'${path}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);

// The asset-type gate validates content matches the extension, so every file must be
// a real SVG (leading <svg root) — not 'AA'. Lengths still differ post-move to prove
// a genuine re-read. (Content-mismatch rejection is the security feature working.)
// ---- S1: build the asset tree on disk + in the deck ----
mkdirSync(join(HOME,'images','sub'),{recursive:true});
writeFileSync(join(HOME,'images','a.svg'),'<svg></svg>');        // 11 bytes
writeFileSync(join(HOME,'images','b.svg'),'<svg></svg>');        // 11
writeFileSync(join(HOME,'images','sub','c.svg'),'<svg></svg>');  // 11
let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
for(const [p,id] of [['images/a.svg','ra'],['images/b.svg','rb'],['images/sub/c.svg','rc']]){
  const r=await execA(sid,`const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${p}',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'${p}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
  if(r!=='ok') fail('store '+id+': '+r);
  await exec(sid,`window.__eigendeck.store.getState().addElement({id:'el-${id}',type:'image',assetId:'${id}',position:{x:100,y:100,width:200,height:200}});`);
}
if(await trust(sid)!=='ok') fail('S1 trust');   // trust + approve the 3 sources, persists the token
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);
console.log('  S1: 3 linked assets under images/, saved');

// ---- move the whole folder, with NEW (longer) bytes to prove a real re-read ----
rmSync(join(HOME,'images'),{recursive:true,force:true});
mkdirSync(join(HOME,'moved','images','sub'),{recursive:true});
writeFileSync(join(HOME,'moved','images','a.svg'),'<svg>AAAAA</svg>');   // 16 bytes
writeFileSync(join(HOME,'moved','images','b.svg'),'<svg>BB</svg>');      // 13
writeFileSync(join(HOME,'moved','images','sub','c.svg'),'<svg>CCC</svg>'); // 14

// ---- S2: reopen → all missing; relocate one; assert the rest follow ----
sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
await trust(sid);   // re-establish trust in this session; rescans (folder moved → all missing)
await sleep(3500);
let m=JSON.parse(await missing(sid));
if(!(m.includes('ra')&&m.includes('rb')&&m.includes('rc'))) fail('not all detected missing on reopen: '+JSON.stringify(m));
console.log('  S2: all 3 detected missing after folder move ✓');

// relocate ONE (ra) the way the UI does: store it at the new path
const oldAbs=join(HOME,'images','a.svg'), newAbs=join(HOME,'moved','images','a.svg');
await execA(sid,`const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'images/a.svg',data:Array.from(new TextEncoder().encode('<svg>AAAAA</svg>')),mimeType:'image/svg+xml',externalPath:${JSON.stringify(newAbs)},externalMtime:null,assetId:'ra'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
// now apply the offset to the others
const res=await execA(sid,`const d=arguments[arguments.length-1];window.__eigendeck.relocateByOffset('ra',${JSON.stringify(oldAbs)},${JSON.stringify(newAbs)}).then(r=>d(JSON.stringify(r))).catch(e=>d('ERR'+e));`);
console.log('  relocateByOffset →', res);
const r=JSON.parse(res);
if(r.relocated!==2) fail(`expected 2 relocated, got ${res}`);

// rb + rc should no longer be missing, and should now hold the NEW bytes
if(!await pollMissingGone(sid,'rb')) fail('rb still missing after offset relocate');
if(!await pollMissingGone(sid,'rc')) fail('rc still missing after offset relocate');
const lb=await byteLen(sid,'rb'), lc=await byteLen(sid,'rc');
await quit(sid);
if(lb!==13) fail(`rb did not re-read moved bytes (len=${lb}, want 13)`);
if(lc!==14) fail(`rc did not re-read moved bytes (len=${lc}, want 14)`);
console.log(`  rb=${lb}B rc=${lc}B from the moved location ✓`);
console.log('RO_PASS: one relocate → folder offset relocates the rest');
process.exit(0);
