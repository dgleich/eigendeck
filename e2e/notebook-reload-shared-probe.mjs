const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}
const fail=(m)=>{console.error('SHARED_FAIL:',m);process.exit(1);};
let sid; for(let i=0;i<12&&!sid;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});sid=j?.value?.sessionId;if(!sid)await sleep(1000);}
for(let i=0;i<20;i++){await sleep(800); if((await dom(sid)).includes('INIT_VAL'))break;}
// Simulate the watcher reload of the shared asset (new bytes + asset-changed event).
const r=await execA(sid,`const d=arguments[arguments.length-1];(async()=>{
  const nb={cells:[{cell_type:'code',source:["k = 'MUTATED_VAL'\\n"],outputs:[],execution_count:null,metadata:{}}],metadata:{kernelspec:{name:'python3',display_name:'Python 3'},language_info:{name:'python'}},nbformat:4,nbformat_minor:5};
  const data=Array.from(new TextEncoder().encode(JSON.stringify(nb)));
  await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'nb.ipynb',data,mimeType:'application/x-ipynb+json',externalPath:'nb.ipynb',externalMtime:null,assetId:'ipy'});
  window.dispatchEvent(new CustomEvent('eigendeck:asset-changed',{detail:{assetId:'ipy'}}));
  d('ok');
})().catch(e=>d('ERR:'+e));`);
if(r!=='ok') fail('reload sim: '+r);
await sleep(1500);
const s1 = (await dom(sid)).includes('MUTATED_VAL');
await exec(sid,"window.__eigendeck.store.getState().selectSlide(1);");
await sleep(1200);
const s2 = (await dom(sid)).includes('MUTATED_VAL');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log(`slide1 updated=${s1} slide2 updated=${s2}`);
console.log((s1&&s2)?'SHARED_PASS: one shared asset → BOTH copies updated from a single reload':'SHARED_FAIL');
process.exit(s1&&s2?0:1);
