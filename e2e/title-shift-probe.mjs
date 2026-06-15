// #47: a title element must not shift vertically when you double-click to edit.
// Measures the on-screen top/bottom of the text in DISPLAY mode (SVG) vs EDIT
// mode (contentEditable) and reports the delta.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('TS_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
// title element, valign defaults to 'bottom'
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'t1',type:'text',preset:'title',html:'My Title',position:{x:200,y:200,width:800,height:400}});");
await sleep(1500);

// Measure the actual TEXT GLYPHS (not the container) via a Range over the
// deepest text node — that's what the eye sees shift.
const measureText = (rootSel) => `
  (function(){
    const root=document.querySelector(${JSON.stringify(rootSel)});
    if(!root) return 'NO_ROOT';
    // find first non-empty text node
    const w=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n, tn=null;
    while((n=w.nextNode())){ if(n.textContent && n.textContent.trim()){ tn=n; break; } }
    if(!tn) return 'NO_TEXT';
    const rng=document.createRange(); rng.selectNodeContents(tn);
    const r=rng.getBoundingClientRect();
    return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),h:Math.round(r.height)});
  })()`;

// DISPLAY mode glyph rect
const disp = await exec(sid, "return "+measureText('[data-element-id="t1"] foreignObject'));
if(typeof disp!=='string'||disp.startsWith('NO')) fail('display measure: '+disp);
console.log('  display text:', disp);

// EDIT mode: fire start-editing, then measure the glyphs in the contentEditable
await exec(sid, "document.querySelector('[data-element-id=\"t1\"]').dispatchEvent(new CustomEvent('start-editing'));");
await sleep(900);
const edit = await exec(sid, "return "+measureText('[data-element-id="t1"] [contenteditable="true"]'));
if(typeof edit!=='string'||edit.startsWith('NO')) fail('edit measure: '+edit);
console.log('  edit text:   ', edit);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
const d=JSON.parse(disp), e=JSON.parse(edit);
const dTop=Math.abs(d.top-e.top), dBot=Math.abs(d.bottom-e.bottom), dLeft=Math.abs(d.left-e.left);
console.log(`  Δtop=${dTop}px Δbottom=${dBot}px Δleft=${dLeft}px`);
// Tolerance: a few px (sub-pixel/caret). Bigger = the #47 shift.
if(dTop<=4 && dBot<=4){ console.log('TS_PASS: title geometry stable across display↔edit'); process.exit(0); }
console.error(`TS_SHIFT: title moves on edit (Δtop=${dTop} Δbottom=${dBot})`); process.exit(2);
