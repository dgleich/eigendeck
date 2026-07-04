// Integration check for #86 under the OPAQUE-ORIGIN framework: the mount splices
// --eigendeck-* vars + data-URL @font-face into a real demo, and a theme switch
// re-mounts the demo with the NEW theme. The parent can't read the demo's
// contentDocument, so theme-probe-demo.html self-reports via postMessage
// {type:'theme-report'}; we assert on that. (Old behavior — vars updated live
// without a reload — no longer holds: opaque origin remounts on theme change.)
import { readFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const DEMO_HTML=readFileSync('/work/e2e/fixtures/theme-probe-demo.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('VERIFY_FAIL:',m);process.exit(1);};
async function reportAfter(sid, sel){ await exec(sid,`window.__tr=null; ${sel}`); for(let k=0;k<16;k++){ await sleep(400); const t=await exec(sid,`return window.__tr`); if(t) return t; } return null; }

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
await exec(sid,`window.__tr=null; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__eigendeck===1&&d.type==='theme-report') window.__tr=d;});`);
// Build slide 0 into a full-bleed theme-probe demo (the fixture self-reports).
const assetId=await exec(sid,`return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'demos/theme-probe.html',data:Array.from(new TextEncoder().encode(${JSON.stringify(DEMO_HTML)})),mimeType:'text/html',externalPath:null,externalMtime:null});`);
if(!assetId||typeof assetId!=='string') fail('db_store_asset returned '+JSON.stringify(assetId));
await exec(sid,`var g=window.__eigendeck.store.getState;g().selectSlide(0);g().updateSlide(0,{theme:'white',elements:[]});g().addElement({id:'tp-demo',type:'demo',assetId:${JSON.stringify(assetId)},position:{x:0,y:0,width:1920,height:1080}});`);
const di = 0;

const before = await reportAfter(sid, `window.__eigendeck.store.getState().selectSlide(${di});`);
if(!before) fail('demo never reported theme vars (vars not injected at mount)');
console.log('  BEFORE '+JSON.stringify(before));
if(!before.fontVar) fail('no --eigendeck-font in the mounted demo');
if(!before.fontLoaded) console.log('  (note: font not yet loaded at first report)');

// Flip this slide's theme to black → the demo re-mounts and must report the new bg.
const after = await reportAfter(sid, `window.__eigendeck.store.getState().updateSlide(${di}, {theme:'black'});`);
if(!after) fail('demo did not re-report after theme switch');
console.log('  AFTER  '+JSON.stringify(after));
const blackBg='rgb(0, 0, 0)';
if(after.bg!==blackBg) fail(`theme switch did not apply: bg ${after.bg} != ${blackBg}`);
if(after.bg===before.bg) fail('bg unchanged after theme switch (theme not re-applied on remount)');
console.log('  ✓ theme switch re-mounted the demo and applied the new theme (bg -> black)');
console.log('VERIFY_DONE');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
process.exit(0);
