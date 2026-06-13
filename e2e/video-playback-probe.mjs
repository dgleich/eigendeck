// Real playback behaviors: native LOOP wraps to the start, and PING-PONG plays
// forward then reverse-seeks back. Codec-dependent (uses fixtures/test.webm).
import { readFileSync } from 'fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('VP_FAIL:', m); process.exit(1); };

const b64 = readFileSync(new URL('./fixtures/test.webm', import.meta.url)).toString('base64');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
await execA(sid, `const d=arguments[arguments.length-1];const bin=atob(${JSON.stringify(b64)});const data=new Array(bin.length);for(let i=0;i<bin.length;i++)data[i]=bin.charCodeAt(i);window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'test.webm',data,mimeType:'video/webm',externalPath:null,externalMtime:null,assetId:'va1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
await exec(sid, `const s=window.__eigendeck.store.getState();
  s.addElement({id:'vl',type:'video',kind:'file',assetId:'va1',loop:true,muted:true,position:{x:40,y:40,width:320,height:240}});
  s.addElement({id:'vp',type:'video',kind:'file',assetId:'va1',pingPong:true,muted:true,position:{x:400,y:40,width:320,height:240}});`);
await sleep(2500);

// (1) LOOP: play and watch currentTime wrap back to ~0 after the end
const loop = await execA(sid, "const d=arguments[arguments.length-1];const v=document.querySelector('[data-element-id=\"vl\"] video');v.muted=true;v.currentTime=0;v.play();let prev=0,wrapped=false,n=0;const iv=setInterval(()=>{const t=v.currentTime;if(prev>0.5&&t<0.2)wrapped=true;prev=t;if(wrapped||++n>30){clearInterval(iv);d(JSON.stringify({wrapped,ended:v.ended}));}},150);");
const L = JSON.parse(loop);
if (!L.wrapped) fail(`loop did not wrap: ${loop}`);

// (2) PING-PONG: play forward to the end, then currentTime must come back down
const pp = await execA(sid, "const d=arguments[arguments.length-1];const v=document.querySelector('[data-element-id=\"vp\"] video');v.muted=true;v.currentTime=0;v.play();let peak=0,reversed=false,n=0;const iv=setInterval(()=>{const t=v.currentTime;if(t>peak)peak=t;if(peak>0.6&&t<peak-0.3)reversed=true;if(reversed||++n>40){clearInterval(iv);d(JSON.stringify({reversed,peak:Math.round(peak*100)/100}));}},150);");
const P = JSON.parse(pp);
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (!P.reversed) fail(`ping-pong did not reverse: ${pp}`);
console.log(`VP_PASS: loop wrapped; ping-pong reversed (peak ${P.peak}s)`);
process.exit(0);
