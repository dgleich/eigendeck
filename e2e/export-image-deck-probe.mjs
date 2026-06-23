// Regression for the export crash "undefined is not an object (src.startsWith)":
// image/demo elements store only assetId (no src), but the exporter reads paths.
// The wrapper must resolve assetId→path before export. Self-contained: store a
// tiny PNG, add an image element bound by assetId only (NO src), then
// exportHtml() must NOT throw and must inline the image as a data: URL.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('EXPORT_FAIL:',m);process.exit(1);};

// 1x1 red PNG.
const PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// Store a PNG asset and add an IMAGE element bound by assetId only (no src) —
// exactly what the editor produces and what crashed the exporter.
const imgId = await exec(sid, `return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'images/red.png',data:Array.from(Uint8Array.from(atob('${PNG_B64}'),c=>c.charCodeAt(0))),mimeType:'image/png',externalPath:null,externalMtime:null});`);
if(!imgId||typeof imgId!=='string') fail('store image asset: '+JSON.stringify(imgId));
await exec(sid, `
  var g=window.__eigendeck.store.getState;
  while(g().presentation.slides.length>1){g().deleteSlide(g().presentation.slides.length-1);}
  g().selectSlide(0); g().updateSlide(0,{elements:[]});
  g().addElement({id:'img',type:'image',kind:'raster',assetId:${JSON.stringify(imgId)},position:{x:60,y:60,width:300,height:300}});
`);
await sleep(300);
// Sanity: the element has assetId and NO src (the condition that crashed).
const shape = await exec(sid, `const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='img'); return JSON.stringify({assetId:!!e.assetId, src:e.src===undefined?'undef':e.src});`);
console.log('  image element:', shape);

const res = await execA(sid, `
  const done = arguments[arguments.length-1];
  Promise.resolve().then(() => window.__eigendeck.exportHtml())
    .then(html => done({ ok:true, len: html.length, dataImgs: (html.match(/src="data:image/g)||[]).length }))
    .catch(e => done({ ok:false, err: String(e) }));`);
if(!res || typeof res!=='object') fail('no result: '+JSON.stringify(res));
if(!res.ok) fail('exportHtml threw: '+res.err);   // the reported crash
if(res.dataImgs < 1) fail('image not inlined as data: URL — assetId→path resolution failed');
console.log(`  export ok: ${res.len} chars, ${res.dataImgs} image(s) inlined from assetId ✓`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('EXPORT_PASS: assetId-only image exports without the src.startsWith crash');
process.exit(0);
