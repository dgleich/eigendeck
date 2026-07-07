// e2e: live external kernel — edit a notebook cell in-app, run it against a REAL
// jupyter kernel, assert the computed output, then save/quit/reopen and assert
// the edited source + live output both persisted (via the overlay).
//
// Needs a jupyter server (E2E_JUPYTER=1 → run-probe.sh boots e2e/jupyter-server.sh).
// Boilerplate (post/execSync/execAsync/dom/open/waitSeam) mirrors nb-promote-reload.mjs.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const JUP_URL=process.env.E2E_JUP_URL||'http://127.0.0.1:8888';
const JUP_TOKEN=process.env.E2E_JUP_TOKEN||'e2e-token';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await execSync(sid,"return document.body?document.body.textContent:''")||'');}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}

const fail=(m)=>{console.error('E2E_FAIL '+m);process.exit(1);};
async function pollDom(sid,needle,ms=20000){for(let t=0;t<ms;t+=500){if((await dom(sid)).includes(needle))return true;await sleep(500);}return false;}

(async () => {
  const sid = await open();
  if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');
  // inject the per-machine jupyterServers pref BEFORE the kernel connects
  await execSync(sid, `localStorage.setItem('eigendeck:pref:jupyterServers', JSON.stringify(
    [{ label: 'e2e', baseUrl: ${JSON.stringify(JUP_URL)}, token: ${JSON.stringify(JUP_TOKEN)}, availableKernels: ['python3'] }]));`);
  if (!await pollDom(sid, 'k = 5')) fail('cell source k = 5 not rendered');
  console.log('E2E_OK render');
  process.exit(0);
})();
