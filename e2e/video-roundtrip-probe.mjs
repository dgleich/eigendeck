// Video elements round-trip through save → reopen with all fields intact
// (codec-independent). Adds a FILE video (assetId + options) and an EMBED video
// (provider + url), saves, reopens, and asserts both persist — kind, the
// promoted assetId, and the data-blob fields (provider, url, loop, pingPong,
// playbackRate, controls, muted).
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('VR_FAIL:', m); process.exit(1); };

// ---- Session 1: add both video kinds, save, quit ----
let sid = await open(); if (!sid || !await waitSeam(sid)) fail('s1 open');
await exec(sid, `const s=window.__eigendeck.store.getState();
  s.addElement({id:'vf',type:'video',kind:'file',assetId:'va1',loop:true,pingPong:true,playbackRate:1.5,controls:true,muted:true,position:{x:60,y:60,width:400,height:300}});
  s.addElement({id:'ve',type:'video',kind:'embed',provider:'youtube',url:'https://youtu.be/dQw4w9WgXcQ',loop:true,playbackRate:1,position:{x:520,y:60,width:400,height:300}});`);
if (await execA(sid, "const d=arguments[arguments.length-1];(async()=>{await window.__eigendeck.flush();await window.__eigendeck.save();d('ok');})().catch(e=>d('ERR'+e));") !== 'ok') fail('save');
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {}); await sleep(2500);

// ---- Session 2: reopen, assert persisted ----
const sid2 = await open(); if (!sid2 || !await waitSeam(sid2)) fail('s2 open');
await sleep(1200);
const j = JSON.parse(await execA(sid2, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_export_json').then(d).catch(e=>d('ERR'+e));"));
const els = j.slides.flatMap((s) => s.elements);
const vf = els.find((e) => e.id === 'vf');
const ve = els.find((e) => e.id === 've');
await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});
console.log('VR_REOPEN file=' + JSON.stringify(vf) + ' embed=' + JSON.stringify(ve));
if (!vf || vf.type !== 'video' || vf.kind !== 'file' || vf.assetId !== 'va1') fail('file video lost kind/assetId');
if (!(vf.loop && vf.pingPong && vf.playbackRate === 1.5 && vf.controls && vf.muted)) fail('file video options lost');
if (!ve || ve.type !== 'video' || ve.kind !== 'embed' || ve.provider !== 'youtube') fail('embed video lost kind/provider');
if (ve.url !== 'https://youtu.be/dQw4w9WgXcQ' || !ve.loop) fail('embed url/loop lost');
console.log('VR_PASS: file + embed video round-trip with all fields');
process.exit(0);
