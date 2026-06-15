// Bug hunt: a missing source is flagged even when auto-reload is OFF (#74 ungating).
import { writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const IMG=join(dirname(DECK),'pic.svg');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=m=>{console.error('OFF_FAIL:',m);process.exit(1);};
const miss=sid=>exec(sid,"try{return JSON.stringify(window.__eigendeck.missingAssets().map(m=>m.assetId));}catch(e){return '[]';}");

writeFileSync(IMG,'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
// store asset with auto_reload explicitly OFF
await execA(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'pic.svg',data:[60,115,118,103,47,62],mimeType:'image/svg+xml',externalPath:'pic.svg',externalMtime:null,assetId:'pa1',autoReload:'off'}).then(()=>d('ok')).catch(e=>d('ERR'+e));");
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'i',type:'image',assetId:'pa1',position:{x:50,y:50,width:100,height:100}});");
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);
unlinkSync(IMG);
sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
let found=false;
for(let i=0;i<18;i++){ await sleep(600); if(JSON.parse(await miss(sid)).includes('pa1')){found=true;break;} }
await quit(sid);
if(!found) fail('missing NOT detected for an auto-reload-OFF asset (ungating regression)');
console.log('OFF_PASS: missing source flagged even with auto-reload OFF');
process.exit(0);
