// #23: changing a text element's font size must update the canvas render.
// Drives updateElement directly (isolating the RENDER path from the inspector
// input), then reads the rendered SVG's baked-in font-size from the canvas DOM.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('FS_FAIL:',m);process.exit(1);};
// read the rendered font-size px baked into the element's SVG markup
async function renderedSize(sid){
  return await exec(sid, `
    const el=document.querySelector('[data-element-id="t1"]');
    if(!el) return 'NO_EL';
    const m=el.innerHTML.match(/font-size:(\\d+)px/);
    return m?m[1]:'NO_FONTSIZE';`);
}
async function pollSize(sid, want){
  for(let i=0;i<15;i++){ await sleep(500); if((await renderedSize(sid))===String(want)) return true; }
  return false;
}

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
// add a textbox text element (default body size 48)
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'t1',type:'text',preset:'textbox',html:'Hello world',position:{x:200,y:200,width:600,height:200}});");
if(!await pollSize(sid, 48)) fail(`baseline not 48 (got ${await renderedSize(sid)})`);
console.log('  baseline textbox renders 48px ✓');

// numeric override → 36
await exec(sid, "window.__eigendeck.store.getState().updateElement('t1',{fontSize:36,fontSizeName:undefined});");
if(!await pollSize(sid, 36)) fail(`numeric override not applied (got ${await renderedSize(sid)})`);
console.log('  fontSize:36 applied to canvas ✓');

// named override → footnote (24)
await exec(sid, "window.__eigendeck.store.getState().updateElement('t1',{fontSize:undefined,fontSizeName:'footnote'});");
if(!await pollSize(sid, 24)) fail(`named override not applied (got ${await renderedSize(sid)})`);
console.log('  fontSizeName:footnote (24) applied to canvas ✓');

// back to a different numeric → 72
await exec(sid, "window.__eigendeck.store.getState().updateElement('t1',{fontSize:72,fontSizeName:undefined});");
if(!await pollSize(sid, 72)) fail(`second numeric not applied (got ${await renderedSize(sid)})`);
console.log('  fontSize:72 applied to canvas ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('FS_PASS: font-size changes render on the canvas');
process.exit(0);
