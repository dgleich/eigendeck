// Take-control → reload workflow with the REAL fs-watch (files in-scope via the
// app's HOME). Steps (David's spec):
//  1 mutate file (watching on) → notebook reloads to the latest;
//  2 take control (editable → watching off) → mutate again → does NOT reload;
//  3 make an in-deck edit → save → quit;
//  4 reopen → the edit persisted;
//  5 mutate the file, click "Reload from disk now" → latest file shown, edit wiped;
//  6 re-enable watching → mutate → reloads again.
import { writeFileSync } from 'fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK, NB=process.env.E2E_NB;
const OVMIME='application/x-eigendeck-overlay+json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function waitDom(sid,s,n=20){for(let i=0;i<n;i++){await sleep(700);if((await dom(sid)).includes(s))return true;}return false;}
const fail=(m)=>{console.error('TCREAL_FAIL:',m);process.exit(1);};
const writeNb=(m)=>writeFileSync(NB, JSON.stringify({cells:[{cell_type:'code',source:[`k = '${m}'\n`],outputs:[],execution_count:null,metadata:{}}],metadata:{kernelspec:{name:'python3',display_name:'Python 3'},language_info:{name:'python'}},nbformat:4,nbformat_minor:5},null,1)+'\n');

// ===== Session 1 =====
let sid=await open(); if(!sid||!await waitSeam(sid)) fail('s1 open');
if(!await waitDom(sid,'INIT_VAL')) fail('INIT_VAL');
// (1) real fs-watch reload
writeNb('WATCHED1');
if(!await waitDom(sid,'WATCHED1')) fail('fs-watch did not reload (WATCHED1)');
console.log('  (1) fs-watch reload OK → WATCHED1');
// (2) take control: editable + watch off
await exec(sid,"window.__eigendeck.store.getState().updateElement('nb1',{editable:true});");
await execA(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_set_asset_auto_reload',{assetId:'ipy',value:'off'}).then(()=>d('ok')).catch(e=>d('ERR'+e));");
await sleep(1500);
writeNb('SHOULD_NOT_LOAD');
const held = !(await waitDom(sid,'SHOULD_NOT_LOAD',6));   // must NOT appear
if(!held) fail('control NOT held — file change reloaded despite watch off');
console.log('  (2) control held: file change ignored while editable');
// (3) in-deck edit (overlay) + save + quit
const ov=JSON.stringify({version:1,cellEdits:{0:"k = 'MY_EDIT'\n"},cellOutputs:{},cellCounts:{},appendedCells:[]});
await execA(sid,`const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'overlay:nb1',data:Array.from(new TextEncoder().encode(${JSON.stringify(ov)})),mimeType:${JSON.stringify(OVMIME)},externalPath:null,externalMtime:null,assetId:'overlay-nb1',autoReload:'off',ownerElementId:'nb1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
if(await execA(sid,"const d=arguments[arguments.length-1];(async()=>{await window.__eigendeck.flush();await window.__eigendeck.save();d('ok');})().catch(e=>d('ERR'+e));")!=='ok') fail('save');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{}); await sleep(2500);

// ===== Session 2 =====
sid=await open(); if(!sid||!await waitSeam(sid)) fail('s2 open');
// (4) edit persisted
if(!await waitDom(sid,'MY_EDIT')) fail('edit did not persist (MY_EDIT)');
console.log('  (4) edit persisted across app reload → MY_EDIT');
// (5) mutate + click "Reload from disk now" → latest + edit wiped
writeNb('RELOADED_FILE');
await exec(sid,"const s=window.__eigendeck.store; if(!s.getState().showProperties) s.getState().toggleProperties(); s.getState().selectObject({type:'element',id:'nb1'});");
await sleep(800);
const clicked = await exec(sid,"const b=[...document.querySelectorAll('button')].find(x=>/Reload from disk/i.test(x.textContent||'')); if(b){b.click();return true;}return false;");
if(!clicked) fail('Reload-from-disk button not found');
if(!await waitDom(sid,'RELOADED_FILE')) fail('Reload from disk did not show RELOADED_FILE');
await sleep(800);
if((await dom(sid)).includes('MY_EDIT')) fail('Reload from disk did NOT wipe the edit');
console.log('  (5) Reload from disk → RELOADED_FILE shown, edit wiped');
// (6) re-enable watching (give back control) → mutate → reloads
await exec(sid,"window.__eigendeck.store.getState().updateElement('nb1',{editable:false});");
// Mirror AssetSection's watch checkbox: set null + fire asset-changed so the
// watcher hook re-evaluates the cascade and RE-subscribes.
await execA(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_set_asset_auto_reload',{assetId:'ipy',value:null}).then(()=>{window.dispatchEvent(new CustomEvent('eigendeck:asset-changed',{detail:{assetId:'ipy'}}));d('ok');}).catch(e=>d('ERR'+e));");
await sleep(1800);
writeNb('REWATCHED');
const rewatch = await waitDom(sid,'REWATCHED',12);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(!rewatch) fail('watching not re-enabled (REWATCHED did not load)');
console.log('  (6) watching re-enabled → REWATCHED loaded');
console.log('TCREAL_PASS: full take-control/reload workflow with the real fs-watch');
process.exit(0);
