// #160: paste a copied FILE onto the canvas → read its bytes and insert as an
// asset. Drives the REAL app: writes a PNG to disk, dispatches a synthetic paste
// whose DataTransfer carries the file's `file://` URL on text/uri-list (the
// Linux/Windows shape), and asserts an image element with a real assetId appears.
// (The macOS public.file-url native-read path can't be driven headlessly; this
// exercises the shared insertPastedFilePaths + readFileNative + insert flow.)
import { writeFileSync } from 'fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('PASTEFILE_FAIL:',m);process.exit(1);};

// A real 1x1 red PNG on disk (HOME is the deck dir, within the read gate's reach).
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const filePath=(process.env.HOME||'/tmp')+'/pasted-src.png';
writeFileSync(filePath, PNG);
// file:// + percent-encoded absolute path (segments encoded, separators kept).
const fileUrl='file://'+filePath.split('/').map(encodeURIComponent).join('/');

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0);");
const nImg=()=>exec(sid,"return window.__eigendeck.store.getState().presentation.slides[0].elements.filter(e=>e.type==='image').length;");
const before=Number(await nImg());

// Self-check: can we set text/uri-list on a synthetic DataTransfer in this engine?
const ok=await exec(sid,`
  const dt=new DataTransfer(); dt.setData('text/uri-list', ${JSON.stringify(fileUrl)});
  return dt.getData('text/uri-list')===${JSON.stringify(fileUrl)};
`);
if(!ok) fail('engine will not hold text/uri-list on a synthetic DataTransfer');

await exec(sid,`
  const dt=new DataTransfer(); dt.setData('text/uri-list', ${JSON.stringify(fileUrl)}+'\\r\\n');
  document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
`);
let after=before;
for(let i=0;i<25;i++){after=Number(await nImg()); if(after>before) break; await sleep(300);}
if(after!==before+1) fail(`expected 1 new image element, got ${after-before} (uri-list paste not handled)`);
const el=JSON.parse(await exec(sid,`
  const imgs=window.__eigendeck.store.getState().presentation.slides[0].elements.filter(e=>e.type==='image');
  const e=imgs[imgs.length-1];
  return JSON.stringify({hasAssetId:!!e.assetId, kind:e.kind});
`));
if(!el.hasAssetId) fail('pasted file image has no assetId (bytes not stored)');
console.log(`  paste text/uri-list(${fileUrl}) → image element (kind=${el.kind}, assetId ✓)`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('PASTEFILE_PASS: pasting a copied file (uri-list) inserts an image asset (#160)');
process.exit(0);
