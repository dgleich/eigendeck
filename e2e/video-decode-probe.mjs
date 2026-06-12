// Real video decode + frame-capture + playback (codec-dependent: needs WebKit's
// GStreamer media plugins — gstreamer1.0-plugins-good [vpx] is enough for the
// committed vp8 webm fixture). Stores the fixture as an asset, adds a kind:'file'
// video element, then asserts the <video> decoded, a real poster frame was
// cached, and muted playback advances.
import { readFileSync } from 'fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('VD_FAIL:', m); process.exit(1); };

const b64 = readFileSync(new URL('./fixtures/test.webm', import.meta.url)).toString('base64');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
await execA(sid, `const d=arguments[arguments.length-1];const bin=atob(${JSON.stringify(b64)});const data=new Array(bin.length);for(let i=0;i<bin.length;i++)data[i]=bin.charCodeAt(i);window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'test.webm',data,mimeType:'video/webm',externalPath:null,externalMtime:null,assetId:'va1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'v1',type:'video',kind:'file',assetId:'va1',muted:true,position:{x:200,y:150,width:320,height:240}});");
await sleep(3000);

// (1) decode: a real video track loaded
const vs = JSON.parse(await exec(sid, "const v=document.querySelector('.el-video video');return JSON.stringify(v?{rs:v.readyState,w:v.videoWidth,h:v.videoHeight,dur:v.duration||0}:{rs:-1,w:0});"));
if (!(vs.rs >= 2 && vs.w > 0 && vs.dur > 0)) fail(`did not decode: ${JSON.stringify(vs)}`);

// (2) frame-capture: a real (non-trivial) poster PNG cached
const previewBytes = await execA(sid, "const d=arguments[arguments.length-1];const I=window.__TAURI_INTERNALS__.invoke;I('db_list_asset_cache_variants',{sourceId:'v1'}).then(vs=>{const p=vs.find(x=>x.variant==='preview');if(!p)return d(0);return I('db_get_asset_cache_bytes',{sourceId:'v1',variant:'preview',width:p.width,height:p.height}).then(b=>d(new Uint8Array(b).length));}).catch(()=>d(-1));");
if (!(previewBytes > 1000)) fail(`no real frame captured (previewBytes=${previewBytes})`);

// (3) playback: muted play advances currentTime
const play = await execA(sid, "const d=arguments[arguments.length-1];const v=document.querySelector('.el-video video');v.muted=true;v.play().then(()=>setTimeout(()=>d(v.currentTime>0?'advanced':'stuck@'+v.currentTime),1200)).catch(e=>d('playerr:'+e));");
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (play !== 'advanced') fail(`playback did not advance: ${play}`);
console.log(`VD_PASS: decoded ${vs.w}x${vs.h} ${Math.round(vs.dur*10)/10}s, frame cached (${previewBytes}B), playback advanced`);
process.exit(0);
